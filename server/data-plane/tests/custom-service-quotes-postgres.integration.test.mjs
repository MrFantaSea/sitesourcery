import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";
import { deflateSync } from "node:zlib";

import pg from "pg";
import {
  createPostgresCustomServicesAccountRepository
} from "../../hosted/custom-services-account-postgres.mjs";
import {
  createPostgresCustomServicesAssessmentQuoteRepository
} from "../../hosted/custom-services-assessment-quote-postgres.mjs";
import {
  createPostgresCustomServicesOwner
} from "../../hosted/custom-services-owner-postgres.mjs";
import {
  createPostgresCustomServicesInvoiceRepository
} from "../../hosted/custom-services-invoice-postgres.mjs";
import {
  createPostgresCustomServicesAssessmentPayment
} from "../../hosted/custom-services-assessment-payment-postgres.mjs";
import {
  createPostgresCustomServicesAssessmentSettlement
} from "../../hosted/custom-services-assessment-settlement-postgres.mjs";
import {
  createPostgresCustomServicesAssessmentWork
} from "../../hosted/custom-services-assessment-work-postgres.mjs";
import {
  createPostgresCustomServicesCustomBuild
} from "../../hosted/custom-services-custom-build-postgres.mjs";
import {
  createPostgresCustomServicesCustomBuildPayment
} from "../../hosted/custom-services-custom-build-payment-postgres.mjs";
import {
  createPostgresCustomServicesCustomBuildWork
} from "../../hosted/custom-services-custom-build-work-postgres.mjs";
import {
  createPostgresCustomServicesCustomBuildProgress
} from "../../hosted/custom-services-custom-build-progress-postgres.mjs";
import {
  createPostgresCustomServicesCustomBuildChangeCompletion
} from "../../hosted/custom-services-custom-build-change-completion-postgres.mjs";
import {
  createPostgresCustomServicesCustomBuildChangePayment
} from "../../hosted/custom-services-custom-build-change-payment-postgres.mjs";
import {
  createPostgresCustomServicesCustomBuildFinalPayment
} from "../../hosted/custom-services-custom-build-final-payment-postgres.mjs";
import {
  createPostgresCustomServicesCustomBuildHandoff
} from "../../hosted/custom-services-custom-build-handoff-postgres.mjs";
import { ExternalEffectError } from "../../domain/errors.mjs";
import {
  projectCustomServicesAssessmentQuote
} from "../../hosted/custom-services-assessment-quote.mjs";
import { canonicalJson, digest } from "../../hosted/security.mjs";

const require = createRequire(import.meta.url);
const {
  createClient: createAbracadabraClient
} = require("../../../abracadabra/app/abracadabra-api.js");

const { Client, Pool } = pg;
const DATABASE_URL =
  process.env.SITESOURCERY_PG_CUSTOM_SERVICE_QUOTES_TEST_URL ??
  process.env.SITESOURCERY_PG_CUSTOM_SERVICES_TEST_URL ??
  null;

assert.ok(
  DATABASE_URL,
  "SITESOURCERY_PG_CUSTOM_SERVICE_QUOTES_TEST_URL or " +
    "SITESOURCERY_PG_CUSTOM_SERVICES_TEST_URL is required"
);

const ASSESSMENT_POLICY_ID =
  "00000000-0000-4000-8000-000000000341";
const CONTRACT_ID = "SS-CUSTOM-SERVICES-2026-08-05.1";
const CONTRACT_DIGEST =
  "9bb93ae1f7ed2bb7015a7d995dabdb014bd94b9362b44727a67b3580f9af57c8";
const APPROVED_ASSESSMENT_PAYMENT_RELEASE = Object.freeze({
  approved: true,
  amountMinor: 20000,
  currency: "USD",
  taxMode: "automatic"
});

function pngCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, payload = Buffer.alloc(0)) {
  const chunk = Buffer.alloc(12 + payload.length);
  chunk.writeUInt32BE(payload.length, 0);
  chunk.write(type, 4, 4, "ascii");
  payload.copy(chunk, 8);
  chunk.writeUInt32BE(
    pngCrc32(chunk.subarray(4, 8 + payload.length)),
    8 + payload.length
  );
  return chunk;
}

function completionPng(width, height, shade) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 0;
  const rows = Buffer.alloc((width + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const start = row * (width + 1);
    rows.fill(shade, start + 1, start + width + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(rows)),
    pngChunk("IEND")
  ]);
}

async function insertRow(client, table, row) {
  assert.match(table, /^[a-z0-9_]+$/u);
  const entries = Object.entries(row);
  for (const [column] of entries) {
    assert.match(column, /^[a-z_]+$/u);
  }
  return client.query(
    `insert into ss.${table} (
       ${entries.map(([column]) => column).join(", ")}
     ) values (
       ${entries.map((_, index) => `$${index + 1}`).join(", ")}
     ) returning *`,
    entries.map(([, value]) => value)
  );
}

async function expectRejected(client, action, pattern) {
  await client.query("savepoint expected_rejection");
  await assert.rejects(action, pattern);
  await client.query("rollback to savepoint expected_rejection");
}

function isoAfter({ days = 0, hours = 0 } = {}) {
  return new Date(
    Date.now() + days * 86_400_000 + hours * 3_600_000
  ).toISOString();
}

function dateAfter(days) {
  return isoAfter({ days }).slice(0, 10);
}

function deliveryManifestAtCanonicalByteCount(targetBytes) {
  const manifest = {
    items: Array.from({ length: 40 }, (_, index) => ({
      label: `Delivery item ${String(index + 1).padStart(2, "0")}`,
      description: "ok"
    }))
  };
  let remaining = targetBytes - Buffer.byteLength(
    canonicalJson(manifest),
    "utf8"
  );
  assert.ok(remaining >= 0, "manifest byte target is below its envelope");
  for (const item of manifest.items) {
    const capacity = 500 - Array.from(item.description).length;
    const twoByteCharacters = Math.min(
      capacity,
      Math.floor(remaining / 2)
    );
    item.description += "é".repeat(twoByteCharacters);
    remaining -= twoByteCharacters * 2;
    if (remaining === 1 && twoByteCharacters < capacity) {
      item.description += "x";
      remaining -= 1;
    }
    if (remaining === 0) break;
  }
  assert.equal(remaining, 0, "manifest byte target exceeds bounded fields");
  assert.equal(
    Buffer.byteLength(canonicalJson(manifest), "utf8"),
    targetBytes
  );
  return manifest;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function within(promise, message, milliseconds = 5000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(message)),
          milliseconds
        );
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitForDatabaseLock(client, backendPid) {
  for (let observation = 0; observation < 500; observation += 1) {
    // This observer intentionally stays inside the transaction that owns the
    // test's advisory lock. PostgreSQL can retain one statistics snapshot for
    // that transaction, so clear it before looking for a waiter that started
    // after the preceding completion waiter.
    await client.query("select pg_stat_clear_snapshot()");
    const activity = await client.query(
      `select wait_event_type
         from pg_stat_activity
        where pid = $1`,
      [backendPid]
    );
    if (activity.rows[0]?.wait_event_type === "Lock") return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
}

function normalizedSql(value) {
  return String(value).replace(/\s+/gu, " ").trim().toLowerCase();
}

function assertLiveJobLockOrder(
  trace,
  { discovery, jobId, label, mutation }
) {
  const mutationEntry = trace.find((entry) => mutation.test(entry.sql));
  assert.ok(mutationEntry, `${label}: live mutation query was not observed`);
  const transaction = trace.filter(
    (entry) => entry.transactionId === mutationEntry.transactionId
  );
  const discoveryIndex = transaction.findIndex((entry) =>
    discovery.test(entry.sql)
  );
  const lockIndex = transaction.findIndex((entry) =>
    /select pg_advisory_xact_lock\(hashtextextended\(\$1, 0\)\)/u.test(
      entry.sql
    )
  );
  const mutationIndex = transaction.indexOf(mutationEntry);
  assert.equal(
    discoveryIndex,
    0,
    `${label}: immutable job discovery was not the first service query`
  );
  assert.ok(
    lockIndex > discoveryIndex && mutationIndex > lockIndex,
    `${label}: expected discovery -> H1M advisory lock -> mutation`
  );
  assert.equal(
    /\bfor update\b/u.test(transaction[discoveryIndex].sql),
    false,
    `${label}: immutable job discovery unexpectedly took a row lock`
  );
  assert.deepEqual(
    transaction[lockIndex].values,
    [`ss-custom-build-h1m:${jobId}`],
    `${label}: wrong shared H1M advisory-lock key`
  );
  const unsafeBeforeLock = transaction.slice(0, lockIndex).filter(
    (entry) =>
      /\bfor update\b/u.test(entry.sql) ||
      /^(?:insert|update|delete)\b/u.test(entry.sql)
  );
  assert.deepEqual(
    unsafeBeforeLock,
    [],
    `${label}: mutable or row-locking query ran before the H1M lock`
  );
  return Object.freeze({
    backendPid: mutationEntry.backendPid,
    transactionId: mutationEntry.transactionId
  });
}

async function seedAccountProject(client, label) {
  const authority = {
    userId: randomUUID(),
    organizationId: randomUUID(),
    billingPolicyId: randomUUID(),
    projectId: randomUUID()
  };
  await client.query(
    "insert into auth.users (id, email) values ($1, $2)",
    [authority.userId, `${label}-${authority.userId}@example.test`]
  );
  await insertRow(client, "hosted_account_profiles", {
    user_id: authority.userId,
    display_name: `${label} account`,
    state: "active"
  });
  await insertRow(client, "billing_policies", {
    id: authority.billingPolicyId,
    policy_key: `${label}-${authority.billingPolicyId}`,
    grace_period: "14 days",
    retention_period: "90 days",
    effective_at: "2026-08-05T00:00:00.000Z"
  });
  await insertRow(client, "organizations", {
    id: authority.organizationId,
    created_by_user_id: authority.userId,
    name: `${label} organization`,
    state: "active"
  });
  await insertRow(client, "organization_memberships", {
    organization_id: authority.organizationId,
    user_id: authority.userId,
    role: "owner",
    state: "active",
    accepted_at: isoAfter()
  });
  await insertRow(client, "projects", {
    id: authority.projectId,
    organization_id: authority.organizationId,
    created_by_user_id: authority.userId,
    billing_policy_id: authority.billingPolicyId,
    name: `${label} website`
  });
  return authority;
}

async function setActor(client, kind, authority, userId = authority.userId) {
  await client.query(
    "select set_config('app.service_actor_kind', $1, true)",
    [kind]
  );
  await client.query(
    "select set_config('app.service_actor_user_id', $1, true)",
    [userId]
  );
  await client.query(
    "select set_config('app.service_actor_organization_id', $1, true)",
    [authority.organizationId]
  );
}

async function seedCustomerAssessmentRequest(client, authority) {
  await setActor(client, "customer", authority);
  await insertRow(client, "service_project_profiles", {
    organization_id: authority.organizationId,
    project_id: authority.projectId,
    customer_user_id: authority.userId,
    origin: "external",
    observed_hostname: "customer.example.com",
    observed_at: isoAfter(),
    platform_family: "unknown",
    ownership_state: "customer_stated",
    takeover_required: true,
    takeover_state: "review_required",
    supportability_state: "not_reviewed"
  });

  const caseId = randomUUID();
  await insertRow(client, "service_cases", {
    id: caseId,
    organization_id: authority.organizationId,
    project_id: authority.projectId,
    customer_user_id: authority.userId,
    created_by_user_id: authority.userId,
    source: "account",
    title: "Bounded website assessment"
  });
  await client.query(
    "update ss.service_cases set state = 'submitted' where id = $1",
    [caseId]
  );

  const offering = await insertRow(client, "service_case_offerings", {
    organization_id: authority.organizationId,
    project_id: authority.projectId,
    case_id: caseId,
    customer_user_id: authority.userId,
    requested_by_user_id: authority.userId,
    policy_id: ASSESSMENT_POLICY_ID
  });
  const intake = await insertRow(client, "service_intakes", {
    organization_id: authority.organizationId,
    project_id: authority.projectId,
    case_id: caseId,
    customer_user_id: authority.userId,
    created_by_user_id: authority.userId,
    source: "account",
    site_display_name: "Customer Website",
    public_scheme: "https",
    public_hostname: "customer.example.com",
    business_name: "Customer Business",
    primary_goal: "Make the website easier to understand.",
    customer_observation: "The phone layout feels crowded.",
    platform_family: "unknown",
    approximate_public_size: "one_to_ten",
    complexity_flags: ["commerce", "forms"],
    customer_ownership_affirmed: true
  });

  return {
    caseId,
    offeringId: offering.rows[0].id,
    intakeId: intake.rows[0].id
  };
}

async function seedOperator(
  client,
  label,
  capabilities = [
    "service_quote_author",
    "service_job_manage",
    "service_document_manage",
    "service_payment_reconcile"
  ]
) {
  const operatorUserId = randomUUID();
  const controlUserId = randomUUID();
  await client.query(
    "insert into auth.users (id, email) values ($1, $2), ($3, $4)",
    [
      operatorUserId,
      `${label}-${operatorUserId}@example.test`,
      controlUserId,
      `${label}-control-${controlUserId}@example.test`
    ]
  );
  await insertRow(client, "hosted_account_profiles", {
    user_id: operatorUserId,
    display_name: `${label} operator`,
    state: "active"
  });
  await insertRow(client, "operator_profiles", {
    user_id: operatorUserId,
    display_label: `${label} operator`,
    state: "held",
    authorized_by_user_id: controlUserId,
    authorized_at: isoAfter()
  });
  for (const capability of capabilities) {
    await insertRow(client, "operator_permissions", {
      operator_user_id: operatorUserId,
      capability,
      state: "held",
      granted_by_user_id: controlUserId,
      granted_at: isoAfter()
    });
    const grant = await insertRow(
      client,
      "service_operator_authority_events",
      {
        operator_user_id: operatorUserId,
        capability,
        event_sequence: 99,
        event_kind: "grant",
        predecessor_event_id: null,
        recorded_by_kind: "deployment_control",
        effective_at: "2001-01-01T00:00:00.000Z",
        expires_at: isoAfter({ days: 2 }),
        created_at: "2001-01-01T00:00:00.000Z"
      }
    );
    assert.equal(Number(grant.rows[0].event_sequence), 1);
    assert.equal(grant.rows[0].event_kind, "grant");
    assert.notEqual(
      grant.rows[0].effective_at.toISOString(),
      "2001-01-01T00:00:00.000Z"
    );
    assert.match(grant.rows[0].event_digest, /^[0-9a-f]{64}$/u);
  }
  return operatorUserId;
}

async function revokeOperator(client, operatorUserId) {
  const revoke = await insertRow(
    client,
    "service_operator_authority_events",
    {
      operator_user_id: operatorUserId,
      capability: "service_quote_author",
      event_sequence: 99,
      event_kind: "revoke",
      predecessor_event_id: null,
      recorded_by_kind: "deployment_control",
      effective_at: "2001-01-01T00:00:00.000Z",
      expires_at: null,
      created_at: "2001-01-01T00:00:00.000Z"
    }
  );
  assert.equal(Number(revoke.rows[0].event_sequence), 2);
  assert.equal(revoke.rows[0].event_kind, "revoke");
  assert.ok(revoke.rows[0].predecessor_event_id);
}

async function insertQuoteRevision(
  client,
  { quoteId, intakeId, reviewTargets, operatorUserId }
) {
  return insertRow(client, "service_quote_revisions", {
    organization_id: randomUUID(),
    project_id: randomUUID(),
    case_id: randomUUID(),
    quote_id: quoteId,
    quote_revision: 999,
    customer_user_id: randomUUID(),
    offering_id: randomUUID(),
    intake_id: intakeId,
    project_profile_revision: 999,
    intake_revision: 999,
    intake_facts_digest: "a".repeat(64),
    review_targets: reviewTargets,
    policy_id: randomUUID(),
    scope_boundary_digest: "b".repeat(64),
    service_amount_minor: 1,
    provider_direct_amount_minor: 1,
    credit_amount_minor: 1,
    subtotal_minor: 1,
    currency: "EUR",
    tax_state: "caller_claimed_tax",
    payment_schedule: "caller_claimed_schedule",
    maximum_websites: 99,
    maximum_representative_pages_or_types: 99,
    maximum_findings: 99,
    desktop_review_included: false,
    phone_review_included: false,
    expanded_assessment_state: "caller_claimed_scope",
    commercial_contract_id: "caller-contract",
    commercial_contract_digest: "c".repeat(64),
    legal_document_id: randomUUID(),
    delivery_date: dateAfter(14),
    issued_at: "2001-01-01T00:00:00.000Z",
    expires_at: isoAfter({ days: 7 }),
    created_by_operator_user_id: operatorUserId,
    created_at: "2001-01-01T00:00:00.000Z"
  });
}

test("custom-service assessment quotes are exact, append-only, and account-bound", async () => {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 4 });
  const client = await pool.connect();
  const providerRunToken = randomUUID().replaceAll("-", "_");
  const providerIds = Object.freeze({
    assessmentCheckout:
      `cs_test_service_assessment_1_${providerRunToken}`,
    assessmentConcurrent:
      `cs_test_service_assessment_concurrent_${providerRunToken}`,
    assessmentExpired:
      `cs_test_service_assessment_expired_${providerRunToken}`,
    assessmentForeignEvent:
      `evt_test_service_assessment_foreign_${providerRunToken}`,
    assessmentLockOrder:
      `cs_test_service_assessment_lock_order_${providerRunToken}`,
    assessmentMismatchEvent:
      `evt_test_service_assessment_mismatch_${providerRunToken}`,
    assessmentPaymentIntent:
      `pi_test_service_assessment_settlement_${providerRunToken}`,
    assessmentPersistence:
      `cs_test_service_assessment_persistence_${providerRunToken}`,
    assessmentReplacement:
      `cs_test_service_assessment_replacement_${providerRunToken}`,
    assessmentSettlementEvent:
      `evt_test_service_assessment_settlement_${providerRunToken}`,
    assessmentSettlementEventAlias:
      `evt_test_service_assessment_settlement_alias_${providerRunToken}`,
    assessmentStripeCustomer:
      `cus_test_service_assessment_settlement_${providerRunToken}`,
    buildChangeCheckout:
      `cs_test_custom_build_change_1_${providerRunToken}`,
    buildChangeEvent:
      `evt_test_custom_build_change_1_${providerRunToken}`,
    buildChangePaymentIntent:
      `pi_test_custom_build_change_1_${providerRunToken}`,
    buildStartCheckout:
      `cs_test_custom_build_start_1_${providerRunToken}`,
    buildStartEvent:
      `evt_test_custom_build_start_1_${providerRunToken}`,
    buildStartPaymentIntent:
      `pi_test_custom_build_start_1_${providerRunToken}`
  });
  try {
    await client.query("begin");

    const contract = await client.query(
      "select ss.hosted_runtime_contract_v35() as marker"
    );
    assert.equal(
      contract.rows[0].marker,
      "canonical-ss-v35-custom-service-quotes"
    );
    const commandContract = await client.query(
      "select ss.hosted_runtime_contract_v36() as marker"
    );
    assert.equal(
      commandContract.rows[0].marker,
      "canonical-ss-v36-custom-service-customer-commands"
    );
    const invoiceContract = await client.query(
      "select ss.hosted_runtime_contract_v37() as marker"
    );
    assert.equal(
      invoiceContract.rows[0].marker,
      "canonical-ss-v37-custom-service-held-invoices"
    );

    const customer = await seedAccountProject(client, "quote-customer");
    const other = await seedAccountProject(client, "other-customer");
    const foreignFinalStripeCustomerId =
      `cus_test_v46_foreign_${randomUUID().replaceAll("-", "_")}`;
    await insertRow(client, "stripe_customers", {
      organization_id: other.organizationId,
      stripe_customer_id: foreignFinalStripeCustomerId
    });
    const firstOperatorId = await seedOperator(client, "first");
    const secondOperatorId = await seedOperator(client, "second");
    const thirdOperatorId = await seedOperator(client, "third");
    const handoffOnlyOperatorId = await seedOperator(
      client,
      "handoff-only",
      ["service_job_manage", "service_document_manage"]
    );

    await client.query("set local role service_role");
    const request = await seedCustomerAssessmentRequest(client, customer);

    const accountReadContexts = [];
    const accountRepository =
      createPostgresCustomServicesAccountRepository({
        authority: {
          async service(context, work) {
            accountReadContexts.push(structuredClone(context));
            return work(client);
          }
        }
      });
    const foundationSnapshot =
      await accountRepository.readFoundationSnapshot({
        actorId: customer.userId,
        customerId: customer.userId,
        organizationId: customer.organizationId,
        projectId: customer.projectId
      });
    assert.deepEqual(accountReadContexts, [
      {
        actorKind: "customer",
        userId: customer.userId,
        organizationId: customer.organizationId,
        readOnly: true
      }
    ]);
    assert.equal(foundationSnapshot.account.customerId, customer.userId);
    assert.equal(foundationSnapshot.profile.origin, "external");
    assert.equal(foundationSnapshot.serviceCase.state, "submitted");
    assert.equal(foundationSnapshot.offering.state, "requested");
    assert.equal(foundationSnapshot.intake.revision, 1);
    assert.equal(
      foundationSnapshot.intake.publicHostname,
      "customer.example.com"
    );

    const ownerAdapterRequest =
      await seedCustomerAssessmentRequest(client, other);
    const ownerRepositoryContexts = [];
    const ownerRepository =
      createPostgresCustomServicesOwner({
        authority: {
          async service(context, work) {
            ownerRepositoryContexts.push(structuredClone(context));
            if (context.actorKind === "operator") {
              await setActor(
                client,
                "operator",
                { organizationId: context.organizationId },
                context.userId
              );
            }
            return work(client);
          }
        }
      });
    const ownerQueue =
      await ownerRepository.listAssessmentRequests({
        userId: firstOperatorId
      });
    const queuedRequest = ownerQueue.requests.find(
      (entry) => entry.caseId === ownerAdapterRequest.caseId
    );
    assert.equal(
      ownerQueue.schema,
      "sitesourcery.custom-services-owner-assessment-queue/v1"
    );
    assert.equal(queuedRequest.organizationId, other.organizationId);
    assert.equal(queuedRequest.currentQuote, null);
    assert.equal(queuedRequest.website.publicUrl, "https://customer.example.com/");

    const ownerIssueInput = {
      commandId: `owner-quote-${randomUUID()}`,
      organizationId: other.organizationId,
      deliveryDate: dateAfter(14),
      reviewTargets: [
        { kind: "page_type", value: "product" },
        { kind: "page", value: "/" }
      ]
    };
    const ownerReceipt =
      await ownerRepository.issueAssessmentQuote(
        { userId: firstOperatorId },
        ownerAdapterRequest.caseId,
        ownerIssueInput
      );
    assert.equal(
      ownerReceipt.schema,
      "sitesourcery.custom-services-owner-assessment-quote/v1"
    );
    assert.equal(ownerReceipt.state, "issued");
    assert.equal(ownerReceipt.quoteRevision, 1);
    assert.deepEqual(ownerReceipt.price, {
      amountMinor: 20000,
      currency: "USD"
    });
    assert.deepEqual(
      await ownerRepository.issueAssessmentQuote(
        { userId: firstOperatorId },
        ownerAdapterRequest.caseId,
        ownerIssueInput
      ),
      ownerReceipt
    );
    const duplicateSafe =
      await ownerRepository.issueAssessmentQuote(
        { userId: firstOperatorId },
        ownerAdapterRequest.caseId,
        {
          ...ownerIssueInput,
          commandId: `owner-quote-${randomUUID()}`
        }
      );
    assert.equal(duplicateSafe.quoteRevision, 1);
    const ownerRevisionCount = await client.query(
      `select count(*)::integer as count
         from ss.service_quote_revisions
        where case_id = $1`,
      [ownerAdapterRequest.caseId]
    );
    assert.equal(ownerRevisionCount.rows[0].count, 1);
    assert.deepEqual(ownerRepositoryContexts, [
      {
        userId: firstOperatorId,
        readOnly: true
      },
      {
        actorKind: "operator",
        userId: firstOperatorId,
        organizationId: other.organizationId
      },
      {
        actorKind: "operator",
        userId: firstOperatorId,
        organizationId: other.organizationId
      },
      {
        actorKind: "operator",
        userId: firstOperatorId,
        organizationId: other.organizationId
      }
    ]);

    await expectRejected(
      client,
      () =>
        insertRow(client, "service_cases", {
          organization_id: customer.organizationId,
          project_id: customer.projectId,
          customer_user_id: customer.userId,
          created_by_user_id: customer.userId,
          source: "account",
          title: "Competing website assessment"
        }),
      /service_cases_one_current_assessment/iu
    );

    await expectRejected(
      client,
      () =>
        insertRow(client, "service_operator_authority_events", {
          operator_user_id: firstOperatorId,
          capability: "service_quote_author",
          event_sequence: 99,
          event_kind: "revoke",
          effective_at: isoAfter(),
          expires_at: null,
          created_at: isoAfter()
        }),
      /permission denied/iu
    );

    const quoteId = randomUUID();
    await expectRejected(
      client,
      () =>
        insertRow(client, "service_quotes", {
          id: quoteId,
          organization_id: customer.organizationId,
          project_id: customer.projectId,
          case_id: request.caseId,
          offering_id: request.offeringId,
          customer_user_id: customer.userId,
          purpose: "assessment",
          created_by_operator_user_id: firstOperatorId
        }),
      /exact authorized operator actor/iu
    );

    await setActor(client, "operator", customer, firstOperatorId);
    const quote = await insertRow(client, "service_quotes", {
      id: quoteId,
      organization_id: customer.organizationId,
      project_id: customer.projectId,
      case_id: request.caseId,
      offering_id: request.offeringId,
      customer_user_id: customer.userId,
      purpose: "assessment",
      current_revision: 0,
      created_by_operator_user_id: firstOperatorId,
      created_at: "2001-01-01T00:00:00.000Z",
      updated_at: "2001-01-01T00:00:00.000Z"
    });
    assert.equal(Number(quote.rows[0].current_revision), 0);
    assert.notEqual(
      quote.rows[0].created_at.toISOString(),
      "2001-01-01T00:00:00.000Z"
    );

    const firstRevision = await insertQuoteRevision(client, {
      quoteId,
      intakeId: request.intakeId,
      reviewTargets: ["page:/", "page:/about", "type:product"],
      operatorUserId: firstOperatorId
    });
    const first = firstRevision.rows[0];
    assert.deepEqual(
      {
        organizationId: first.organization_id,
        projectId: first.project_id,
        caseId: first.case_id,
        customerUserId: first.customer_user_id,
        offeringId: first.offering_id,
        revision: Number(first.quote_revision),
        profileRevision: Number(first.project_profile_revision),
        intakeRevision: Number(first.intake_revision),
        amount: Number(first.service_amount_minor),
        providerDirect: Number(first.provider_direct_amount_minor),
        credit: Number(first.credit_amount_minor),
        subtotal: Number(first.subtotal_minor),
        currency: first.currency,
        taxState: first.tax_state,
        paymentSchedule: first.payment_schedule,
        websites: first.maximum_websites,
        pagesOrTypes: first.maximum_representative_pages_or_types,
        findings: first.maximum_findings,
        desktop: first.desktop_review_included,
        phone: first.phone_review_included,
        expanded: first.expanded_assessment_state,
        contractId: first.commercial_contract_id,
        contractDigest: first.commercial_contract_digest,
        operatorUserId: first.created_by_operator_user_id
      },
      {
        organizationId: customer.organizationId,
        projectId: customer.projectId,
        caseId: request.caseId,
        customerUserId: customer.userId,
        offeringId: request.offeringId,
        revision: 1,
        profileRevision: 1,
        intakeRevision: 1,
        amount: 20000,
        providerDirect: 0,
        credit: 0,
        subtotal: 20000,
        currency: "USD",
        taxState: "calculation_required",
        paymentSchedule: "full_before_work",
        websites: 1,
        pagesOrTypes: 5,
        findings: 10,
        desktop: true,
        phone: true,
        expanded: "separately_quoted",
        contractId: CONTRACT_ID,
        contractDigest: CONTRACT_DIGEST,
        operatorUserId: firstOperatorId
      }
    );
    assert.match(first.intake_facts_digest, /^[0-9a-f]{64}$/u);
    assert.match(first.quote_digest, /^[0-9a-f]{64}$/u);
    assert.match(first.disclosure_digest, /^[0-9a-f]{64}$/u);
    assert.notEqual(first.quote_digest, first.disclosure_digest);
    assert.notEqual(first.issued_at.toISOString(), "2001-01-01T00:00:00.000Z");

    const invoiceMaterialized = await client.query(
      `select
         (select count(*)::integer from ss.service_quote_lines
           where quote_revision_id = $1) as lines,
         (select count(*)::integer from ss.service_quote_line_coverages
           where quote_revision_id = $1) as coverages,
         (select count(*)::integer from ss.service_quote_installments
           where quote_revision_id = $1) as installments,
         (select count(*)::integer from ss.service_quote_review_targets
           where quote_revision_id = $1) as targets`,
      [first.id]
    );
    assert.deepEqual(invoiceMaterialized.rows[0], {
      lines: 1,
      coverages: 4,
      installments: 1,
      targets: 3
    });
    const targets = await client.query(
      `select target_number, target_kind, target_value
         from ss.service_quote_review_targets
        where quote_revision_id = $1
        order by target_number`,
      [first.id]
    );
    assert.deepEqual(targets.rows, [
      { target_number: 1, target_kind: "page", target_value: "/" },
      { target_number: 2, target_kind: "page", target_value: "/about" },
      { target_number: 3, target_kind: "page_type", target_value: "product" }
    ]);

    await client.query("savepoint withdrawn_quote");
    await setActor(client, "customer", customer);
    await client.query(
      "update ss.service_cases set state = 'withdrawn' where id = $1",
      [request.caseId]
    );
    await client.query(
      "update ss.service_case_offerings set state = 'removed' where id = $1",
      [request.offeringId]
    );
    await expectRejected(
      client,
      () =>
        insertRow(client, "service_quote_acceptances", {
          quote_id: quoteId,
          acceptance_statement: "accepted_exact_quote_and_delivery_date",
          accepted_quote_digest: first.quote_digest,
          accepted_disclosure_digest: first.disclosure_digest,
          request_id: randomUUID()
        }),
      /exact current customer authority/iu
    );
    await client.query("rollback to savepoint withdrawn_quote");
    await setActor(client, "operator", customer, firstOperatorId);

    await expectRejected(
      client,
      () =>
        insertQuoteRevision(client, {
          quoteId,
          intakeId: request.intakeId,
          reviewTargets: ["page:/about", "page:/"],
          operatorUserId: firstOperatorId
        }),
      /service quote timing is invalid/iu
    );
    await expectRejected(
      client,
      () =>
        insertQuoteRevision(client, {
          quoteId,
          intakeId: request.intakeId,
          reviewTargets: [
            "page:/",
            "page:/a",
            "page:/b",
            "page:/c",
            "page:/d",
            "page:/e"
          ],
          operatorUserId: firstOperatorId
        }),
      /service quote timing is invalid/iu
    );
    await expectRejected(
      client,
      () =>
        insertQuoteRevision(client, {
          quoteId,
          intakeId: request.intakeId,
          reviewTargets: ["page:/api_key=sk_live_secretmaterial"],
          operatorUserId: firstOperatorId
        }),
      /service quote timing is invalid/iu
    );

    await setActor(client, "customer", other);
    await expectRejected(
      client,
      () =>
        insertRow(client, "service_quote_acceptances", {
          quote_id: quoteId,
          acceptance_statement: "accepted_exact_quote_and_delivery_date",
          accepted_quote_digest: first.quote_digest,
          accepted_disclosure_digest: first.disclosure_digest,
          request_id: randomUUID()
        }),
      /exact current customer authority/iu
    );

    await setActor(client, "customer", customer);
    await client.query(
      `update ss.service_project_profiles
          set observed_at = clock_timestamp()
        where project_id = $1`,
      [customer.projectId]
    );
    const laterIntake = await insertRow(client, "service_intakes", {
      organization_id: customer.organizationId,
      project_id: customer.projectId,
      case_id: request.caseId,
      customer_user_id: customer.userId,
      created_by_user_id: customer.userId,
      source: "account",
      site_display_name: "Customer Website",
      public_scheme: "https",
      public_hostname: "customer.example.com",
      business_name: "Customer Business",
      primary_goal: "Make pricing and contact options easier to understand.",
      customer_observation: "The mobile navigation is also unclear.",
      platform_family: "unknown",
      approximate_public_size: "one_to_ten",
      complexity_flags: ["commerce", "forms"],
      customer_ownership_affirmed: true
    });
    assert.equal(Number(laterIntake.rows[0].revision), 2);
    await expectRejected(
      client,
      () =>
        insertRow(client, "service_quote_acceptances", {
          quote_id: quoteId,
          acceptance_statement: "accepted_exact_quote_and_delivery_date",
          accepted_quote_digest: first.quote_digest,
          accepted_disclosure_digest: first.disclosure_digest,
          request_id: randomUUID()
        }),
      /exact current customer authority/iu
    );

    await client.query("reset role");
    await revokeOperator(client, firstOperatorId);
    await client.query("set local role service_role");
    await setActor(client, "operator", customer, firstOperatorId);
    await expectRejected(
      client,
      () =>
        insertQuoteRevision(client, {
          quoteId,
          intakeId: laterIntake.rows[0].id,
          reviewTargets: ["page:/", "type:product"],
          operatorUserId: firstOperatorId
        }),
      /lacks current operator authority/iu
    );

    await setActor(client, "operator", customer, secondOperatorId);
    const replacementRevision = await insertQuoteRevision(client, {
      quoteId,
      intakeId: laterIntake.rows[0].id,
      reviewTargets: ["page:/", "type:product"],
      operatorUserId: firstOperatorId
    });
    const replacement = replacementRevision.rows[0];
    assert.equal(Number(replacement.quote_revision), 2);
    assert.equal(Number(replacement.project_profile_revision), 2);
    assert.equal(Number(replacement.intake_revision), 2);
    assert.equal(replacement.created_by_operator_user_id, secondOperatorId);

    await setActor(client, "customer", customer);
    const quoteRepositoryContexts = [];
    const quoteRepository =
      createPostgresCustomServicesAssessmentQuoteRepository({
        authority: {
          async service(context, work) {
            quoteRepositoryContexts.push(structuredClone(context));
            return work(client);
          }
        }
      });
    const quoteScope = {
      actorId: customer.userId,
      customerId: customer.userId,
      organizationId: customer.organizationId,
      projectId: customer.projectId
    };
    const reviewSnapshot =
      await quoteRepository.readCurrentQuote(quoteScope);
    const reviewProjection =
      projectCustomServicesAssessmentQuote({
        scope: quoteScope,
        snapshot: reviewSnapshot
      });
    assert.equal(reviewProjection.state, "review_required");
    assert.equal(reviewProjection.quote.servicePrice.amountMinor, 20000);
    assert.equal(reviewProjection.quote.revision, 2);

    const acceptanceCommandId = `quote-accept-${randomUUID()}`;
    const acceptanceInput = {
      ...quoteScope,
      acceptanceStatement: "accepted_exact_quote_and_delivery_date",
      acceptedDisclosureDigest:
        reviewProjection.quote.disclosureDigest,
      acceptedQuoteDigest: reviewProjection.quote.quoteDigest,
      commandId: acceptanceCommandId,
      quoteId: reviewProjection.quote.quoteId,
      quoteRevision: reviewProjection.quote.revision
    };
    const acceptanceReceipt =
      await quoteRepository.acceptCurrentQuote(acceptanceInput);
    assert.deepEqual(
      await quoteRepository.acceptCurrentQuote(acceptanceInput),
      acceptanceReceipt
    );
    assert.equal(acceptanceReceipt.state, "accepted");
    assert.equal(acceptanceReceipt.quoteId, quoteId);
    assert.equal(acceptanceReceipt.quoteRevision, 2);

    const acceptedSnapshot =
      await quoteRepository.readCurrentQuote(quoteScope);
    const acceptedProjection =
      projectCustomServicesAssessmentQuote({
        scope: quoteScope,
        snapshot: acceptedSnapshot
      });
    assert.equal(acceptedProjection.state, "accepted");
    assert.equal(acceptedProjection.actions.acceptQuote.available, false);

    const heldInvoiceRepository =
      createPostgresCustomServicesInvoiceRepository({
        authority: {
          async service(_context, work) {
            return work(client);
          }
        },
        release: {
          ...APPROVED_ASSESSMENT_PAYMENT_RELEASE,
          approved: false
        }
      });
    const heldInvoiceProjection =
      await heldInvoiceRepository.readCurrentInvoice(quoteScope);
    assert.equal(
      heldInvoiceProjection.state,
      "tax_calculation_pending"
    );
    assert.equal(
      heldInvoiceProjection.actions.checkout.reason,
      "payment_release_held"
    );
    assert.equal(
      heldInvoiceProjection.invoice.payment.checkoutAvailable,
      false
    );

    const invoiceRepositoryContexts = [];
    const invoiceRepository =
      createPostgresCustomServicesInvoiceRepository({
        authority: {
          async service(context, work) {
            invoiceRepositoryContexts.push(structuredClone(context));
            return work(client);
          }
        },
        release: APPROVED_ASSESSMENT_PAYMENT_RELEASE
      });
    const invoiceProjection =
      await invoiceRepository.readCurrentInvoice(quoteScope);
    assert.equal(
      invoiceProjection.schema,
      "sitesourcery.custom-services-assessment-invoice/v2"
    );
    assert.equal(invoiceProjection.state, "checkout_available");
    assert.equal(invoiceProjection.invoice.subtotal.amountMinor, 20000);
    assert.equal(invoiceProjection.invoice.tax.amountMinor, null);
    assert.equal(invoiceProjection.invoice.total.amountMinor, null);
    assert.equal(invoiceProjection.invoice.payment.checkoutAvailable, true);
    assert.equal(invoiceProjection.invoice.payment.chargeOccurred, false);
    assert.match(invoiceProjection.invoice.invoiceNumber, /^SSA-[0-9A-F]{32}$/u);
    assert.deepEqual(invoiceRepositoryContexts, [
      {
        actorKind: "customer",
        userId: customer.userId,
        organizationId: customer.organizationId,
        readOnly: true
      }
    ]);

    const checkoutCalls = [];
    const checkoutContexts = [];
    const assessmentPayment =
      createPostgresCustomServicesAssessmentPayment({
        authority: {
          async service(context, work) {
            checkoutContexts.push(structuredClone(context));
            await setActor(
              client,
              context.actorKind,
              customer,
              context.userId
            );
            return work(client);
          }
        },
        provider: {
          async createServiceAssessmentCheckout(input) {
            checkoutCalls.push(structuredClone(input));
            return {
              checkoutId: providerIds.assessmentCheckout,
              url:
                "https://checkout.stripe.com/c/pay/service_assessment_1",
              expiresAt: isoAfter({ hours: 1 })
            };
          }
        },
        release: APPROVED_ASSESSMENT_PAYMENT_RELEASE
      });
    const checkoutInput = {
      ...quoteScope,
      commandId: `assessment-checkout-${randomUUID()}`,
      invoiceId: invoiceProjection.invoice.invoiceId,
      invoiceDigest: invoiceProjection.invoice.invoiceDigest
    };
    const checkout =
      await assessmentPayment.createCheckout(checkoutInput);
    assert.equal(checkout.state, "ready");
    assert.equal(checkout.checkout.subtotal.amountMinor, 20000);
    assert.equal(checkout.checkout.tax.state, "calculated_at_checkout");
    assert.equal(checkout.checkout.total.state, "shown_at_checkout");
    assert.equal(checkout.checkout.chargeOccurred, false);
    assert.equal(
      Object.hasOwn(checkout.checkout, "checkoutSessionId"),
      false
    );
    assert.deepEqual(
      await assessmentPayment.createCheckout(checkoutInput),
      checkout
    );
    assert.equal(checkoutCalls.length, 1);
    assert.equal(
      checkoutCalls[0].purpose.invoiceId,
      invoiceProjection.invoice.invoiceId
    );
    assert.equal(
      checkoutCalls[0].purpose.price.amountMinor,
      20000
    );
    assert.equal(
      checkoutCalls[0].purpose.price.taxBehavior,
      "automatic_exclusive"
    );
    assert.equal(checkoutContexts.length, 3);

    const replayTampering = [
      {
        ...checkout,
        checkout: {
          ...checkout.checkout,
          expiresAt: "2000-01-01T00:00:00.000Z"
        }
      },
      {
        ...checkout,
        checkout: {
          ...checkout.checkout,
          invoiceId: randomUUID()
        }
      },
      {
        ...checkout,
        checkout: {
          ...checkout.checkout,
          invoiceNumber:
            "SSA-00000000000040008000000000000000"
        }
      },
      {
        ...checkout,
        checkout: {
          ...checkout.checkout,
          url:
            "https://checkout.stripe.com/c/pay/another_invoice"
        }
      },
      { ...checkout, providerSecret: "must-not-leak" }
    ];
    for (const tamperedResponse of replayTampering) {
      await client.query(
        `update ss.idempotency_keys
            set response_body = $3::jsonb
          where principal_id = $1
            and route_key = 'custom-services.assessment-checkout'
            and idempotency_key = $2`,
        [
          customer.userId,
          checkoutInput.commandId,
          JSON.stringify(tamperedResponse)
        ]
      );
      await assert.rejects(
        assessmentPayment.createCheckout(checkoutInput),
        (error) =>
          error.code ===
            "ASSESSMENT_CHECKOUT_RECONCILIATION_REQUIRED"
      );
    }
    assert.equal(checkoutCalls.length, 1);

    const checkoutProjection =
      await invoiceRepository.readCurrentInvoice(quoteScope);
    assert.equal(checkoutProjection.state, "checkout_available");
    assert.equal(
      checkoutProjection.invoice.payment.checkoutAvailable,
      true
    );

    const materialized = await client.query(
      `select
         (select count(*)::int from ss.service_invoices
           where quote_id = $1) as invoices,
         (select count(*)::int from ss.service_invoice_lines line
           join ss.service_invoices invoice on invoice.id = line.invoice_id
          where invoice.quote_id = $1) as lines,
         (select count(*)::int from ss.service_payment_reservations reservation
           join ss.service_invoices invoice on invoice.id = reservation.invoice_id
          where invoice.quote_id = $1) as reservations,
         (select count(*)::int
            from ss.service_assessment_checkout_attempts attempt
            join ss.service_invoices invoice on invoice.id = attempt.invoice_id
           where invoice.quote_id = $1) as checkout_attempts`,
      [quoteId]
    );
    assert.deepEqual(materialized.rows[0], {
      invoices: 1,
      lines: 1,
      reservations: 1,
      checkout_attempts: 1
    });

    const foreignProviderCalls = [];
    const foreignAssessmentPayment =
      createPostgresCustomServicesAssessmentPayment({
        authority: {
          async service(context, work) {
            await setActor(
              client,
              context.actorKind,
              customer,
              context.userId
            );
            return work(client);
          }
        },
        provider: {
          async createServiceAssessmentCheckout(input) {
            foreignProviderCalls.push(structuredClone(input));
            throw new Error("foreign scope reached Stripe");
          }
        },
        release: APPROVED_ASSESSMENT_PAYMENT_RELEASE
      });
    for (const changed of [
      { organizationId: randomUUID() },
      { projectId: randomUUID() },
      { invoiceId: randomUUID() },
      { invoiceDigest: "0".repeat(64) }
    ]) {
      await assert.rejects(
        foreignAssessmentPayment.createCheckout({
          ...checkoutInput,
          ...changed,
          commandId: `assessment-foreign-${randomUUID()}`
        }),
        (error) =>
          [
            "ASSESSMENT_INVOICE_UNAVAILABLE",
            "ASSESSMENT_INVOICE_CONFLICT"
          ].includes(error.code)
      );
    }
    assert.equal(foreignProviderCalls.length, 0);

    await client.query("savepoint concurrent_checkout_commands");
    await setActor(client, "customer", customer);
    await client.query(
      `update ss.service_assessment_checkout_attempts
          set state = 'expired'
        where invoice_id = $1 and state = 'ready'`,
      [checkoutInput.invoiceId]
    );
    let concurrentPayment;
    const concurrentProviderCalls = [];
    concurrentPayment =
      createPostgresCustomServicesAssessmentPayment({
        authority: {
          async service(context, work) {
            await setActor(
              client,
              context.actorKind,
              customer,
              context.userId
            );
            return work(client);
          }
        },
        provider: {
          async createServiceAssessmentCheckout(input) {
            concurrentProviderCalls.push(structuredClone(input));
            await assert.rejects(
              concurrentPayment.createCheckout({
                ...checkoutInput,
                commandId:
                  `assessment-concurrent-${randomUUID()}`
              }),
              (error) =>
                error.code ===
                  "ASSESSMENT_CHECKOUT_IN_PROGRESS"
            );
            return {
              checkoutId: providerIds.assessmentConcurrent,
              url:
                "https://checkout.stripe.com/c/pay/service_assessment_concurrent",
              expiresAt: isoAfter({ hours: 1 })
            };
          }
        },
        release: APPROVED_ASSESSMENT_PAYMENT_RELEASE
      });
    await concurrentPayment.createCheckout({
      ...checkoutInput,
      commandId: `assessment-primary-${randomUUID()}`
    });
    assert.equal(concurrentProviderCalls.length, 1);
    await client.query("rollback to savepoint concurrent_checkout_commands");

    await client.query("savepoint ambiguous_provider_transport");
    await setActor(client, "customer", customer);
    await client.query(
      `update ss.service_assessment_checkout_attempts
          set state = 'expired'
        where invoice_id = $1 and state = 'ready'`,
      [checkoutInput.invoiceId]
    );
    let transportProviderCalls = 0;
    const transportCommandId =
      `assessment-transport-${randomUUID()}`;
    const transportPayment =
      createPostgresCustomServicesAssessmentPayment({
        authority: {
          async service(context, work) {
            await setActor(
              client,
              context.actorKind,
              customer,
              context.userId
            );
            return work(client);
          }
        },
        provider: {
          async createServiceAssessmentCheckout() {
            transportProviderCalls += 1;
            throw new Error("transport outcome unknown");
          }
        },
        release: APPROVED_ASSESSMENT_PAYMENT_RELEASE
      });
    const transportInput = {
      ...checkoutInput,
      commandId: transportCommandId
    };
    await assert.rejects(
      transportPayment.createCheckout(transportInput),
      (error) =>
        error.code ===
          "ASSESSMENT_CHECKOUT_RECONCILIATION_REQUIRED"
    );
    const transportAttempt = await client.query(
      `select attempt.state, attempt.provider_effect_certainty,
              command.state as command_state
         from ss.service_assessment_checkout_attempts attempt
         join ss.idempotency_keys command
           on command.resource_id = attempt.id
        where attempt.command_id = $1`,
      [transportCommandId]
    );
    assert.deepEqual(transportAttempt.rows[0], {
      state: "persistence_unknown",
      provider_effect_certainty: "ambiguous",
      command_state: "running"
    });
    await assert.rejects(
      transportPayment.createCheckout(transportInput),
      (error) =>
        error.code ===
          "ASSESSMENT_CHECKOUT_RECONCILIATION_REQUIRED"
    );
    assert.equal(transportProviderCalls, 1);
    await client.query("rollback to savepoint ambiguous_provider_transport");

    await client.query("savepoint post_provider_persistence_failure");
    await setActor(client, "customer", customer);
    await client.query(
      `update ss.service_assessment_checkout_attempts
          set state = 'expired'
        where invoice_id = $1 and state = 'ready'`,
      [checkoutInput.invoiceId]
    );
    let persistenceAuthorityCalls = 0;
    let persistenceProviderCalls = 0;
    const persistenceCommandId =
      `assessment-persistence-${randomUUID()}`;
    const persistencePayment =
      createPostgresCustomServicesAssessmentPayment({
        authority: {
          async service(context, work) {
            persistenceAuthorityCalls += 1;
            await setActor(
              client,
              context.actorKind,
              customer,
              context.userId
            );
            if (persistenceAuthorityCalls === 2) {
              throw new Error("Checkout persistence unavailable");
            }
            return work(client);
          }
        },
        provider: {
          async createServiceAssessmentCheckout() {
            persistenceProviderCalls += 1;
            return {
              checkoutId: providerIds.assessmentPersistence,
              url:
                "https://checkout.stripe.com/c/pay/service_assessment_persistence",
              expiresAt: isoAfter({ hours: 1 })
            };
          }
        },
        release: APPROVED_ASSESSMENT_PAYMENT_RELEASE
      });
    const persistenceInput = {
      ...checkoutInput,
      commandId: persistenceCommandId
    };
    await assert.rejects(
      persistencePayment.createCheckout(persistenceInput),
      (error) =>
        error.code ===
          "ASSESSMENT_CHECKOUT_RECONCILIATION_REQUIRED"
    );
    const persistenceAttempt = await client.query(
      `select attempt.state, attempt.provider_effect_certainty,
              command.state as command_state
         from ss.service_assessment_checkout_attempts attempt
         join ss.idempotency_keys command
           on command.resource_id = attempt.id
        where attempt.command_id = $1`,
      [persistenceCommandId]
    );
    assert.deepEqual(persistenceAttempt.rows[0], {
      state: "persistence_unknown",
      provider_effect_certainty: "ambiguous",
      command_state: "running"
    });
    await assert.rejects(
      persistencePayment.createCheckout(persistenceInput),
      (error) =>
        error.code ===
          "ASSESSMENT_CHECKOUT_RECONCILIATION_REQUIRED"
    );
    assert.equal(persistenceProviderCalls, 1);
    await client.query("rollback to savepoint post_provider_persistence_failure");

    await client.query("savepoint expired_ready_checkout");
    await setActor(client, "customer", customer);
    await client.query(
      `update ss.service_assessment_checkout_attempts
          set state = 'expired'
        where invoice_id = $1 and state = 'ready'`,
      [checkoutInput.invoiceId]
    );
    const expiredAttemptId = randomUUID();
    const expiredAttemptCommand =
      `assessment-expired-${randomUUID()}`;
    await client.query(
      `insert into ss.service_assessment_checkout_attempts (
         id, organization_id, project_id, customer_user_id,
         invoice_id, command_id, provider, purpose_digest,
         invoice_digest, accepted_disclosure_digest,
         expected_subtotal_minor, currency, tax_mode,
         state, provider_effect_certainty, created_at, updated_at
       )
       select $2, organization_id, project_id, customer_user_id,
              invoice_id, $3, provider, purpose_digest,
              invoice_digest, accepted_disclosure_digest,
              expected_subtotal_minor, currency, tax_mode,
              'provider_pending', 'not_submitted',
              (
                select max(existing.created_at) + interval '1 microsecond'
                  from ss.service_assessment_checkout_attempts existing
                 where existing.invoice_id = $1
              ),
              (
                select max(existing.created_at) + interval '1 microsecond'
                  from ss.service_assessment_checkout_attempts existing
                 where existing.invoice_id = $1
              )
         from ss.service_assessment_checkout_attempts
        where invoice_id = $1
        order by created_at desc
        limit 1`,
      [
        checkoutInput.invoiceId,
        expiredAttemptId,
        expiredAttemptCommand
      ]
    );
    await client.query(
      `update ss.service_assessment_checkout_attempts
          set state = 'ready',
              provider_effect_certainty = 'confirmed',
              checkout_session_id = $2,
              checkout_url =
                'https://checkout.stripe.com/c/pay/service_assessment_expired',
              expires_at =
                greatest(
                  clock_timestamp() - interval '100 milliseconds',
                  created_at + interval '1 microsecond'
                )
        where id = $1`,
      [expiredAttemptId, providerIds.assessmentExpired]
    );
    const expiredProjection =
      await invoiceRepository.readCurrentInvoice(quoteScope);
    assert.equal(
      expiredProjection.state,
      "tax_calculation_pending"
    );
    assert.equal(
      expiredProjection.actions.checkout.reason,
      "reconciliation_required"
    );
    let expiredProviderCalls = 0;
    let expiredLifecycleCalls = 0;
    const expiredProvider = {
      async createServiceAssessmentCheckout() {
        expiredProviderCalls += 1;
        return {
          checkoutId:
            providerIds.assessmentReplacement,
          url:
            "https://checkout.stripe.com/c/pay/service_assessment_replacement",
          expiresAt: isoAfter({ hours: 1 })
        };
      },
      async retrieveServiceAssessmentPayment() {
        throw new Error("expiry must not read payment facts");
      },
      async retrieveServiceAssessmentCheckoutLifecycle(input) {
        expiredLifecycleCalls += 1;
        assert.equal(
          input.checkoutSessionId,
          providerIds.assessmentExpired
        );
        return {
          schema:
            "sitesourcery.stripe-service-assessment-checkout-lifecycle/v1",
          provider: "stripe",
          checkoutSessionId: input.checkoutSessionId,
          purposeDigest: input.purposeDigest,
          state: "expired"
        };
      }
    };
    const expiredAuthority = {
      async service(context, work) {
        await setActor(
          client,
          context.actorKind,
          customer,
          context.userId ?? customer.userId
        );
        return work(client);
      }
    };
    const expiredReconciliation =
      createPostgresCustomServicesAssessmentSettlement({
        authority: expiredAuthority,
        provider: expiredProvider,
        clock: { now: () => new Date().toISOString() },
        ids: { next: () => randomUUID() }
      });
    const expiredPayment =
      createPostgresCustomServicesAssessmentPayment({
        authority: expiredAuthority,
        provider: expiredProvider,
        release: APPROVED_ASSESSMENT_PAYMENT_RELEASE,
        reconciliation: expiredReconciliation
      });
    await assert.rejects(
      expiredPayment.createCheckout({
        ...checkoutInput,
        commandId: `assessment-after-expiry-${randomUUID()}`
      }),
      (error) =>
        error.code ===
          "ASSESSMENT_CHECKOUT_REQUIRES_NEW_COMMAND"
    );
    assert.equal(expiredProviderCalls, 0);
    assert.equal(expiredLifecycleCalls, 1);
    const replacementCheckout = await expiredPayment.createCheckout({
      ...checkoutInput,
      commandId: `assessment-replacement-${randomUUID()}`
    });
    assert.equal(replacementCheckout.state, "ready");
    assert.equal(expiredProviderCalls, 1);
    assert.equal(expiredLifecycleCalls, 1);
    await client.query("rollback to savepoint expired_ready_checkout");

    assert.deepEqual(quoteRepositoryContexts, [
      {
        actorKind: "customer",
        userId: customer.userId,
        organizationId: customer.organizationId,
        readOnly: true
      },
      {
        actorKind: "customer",
        userId: customer.userId,
        organizationId: customer.organizationId
      },
      {
        actorKind: "customer",
        userId: customer.userId,
        organizationId: customer.organizationId
      },
      {
        actorKind: "customer",
        userId: customer.userId,
        organizationId: customer.organizationId,
        readOnly: true
      }
    ]);

    const acceptance = await client.query(
      "select * from ss.service_quote_acceptances where quote_id = $1",
      [quoteId]
    );
    const acceptanceCommand = await client.query(
      `select id from ss.idempotency_keys
        where principal_id = $1
          and route_key = 'custom_services.assessment_quote.accept'
          and idempotency_key = $2`,
      [customer.userId, acceptanceCommandId]
    );
    assert.equal(acceptanceCommand.rowCount, 1);
    const acceptanceRequestId = acceptanceCommand.rows[0].id;
    assert.deepEqual(
      {
        organizationId: acceptance.rows[0].organization_id,
        projectId: acceptance.rows[0].project_id,
        caseId: acceptance.rows[0].case_id,
        customerUserId: acceptance.rows[0].customer_user_id,
        revisionId: acceptance.rows[0].quote_revision_id,
        revision: Number(acceptance.rows[0].quote_revision),
        acceptedBy: acceptance.rows[0].accepted_by_user_id,
        quoteDigest: acceptance.rows[0].accepted_quote_digest,
        disclosureDigest: acceptance.rows[0].accepted_disclosure_digest,
        requestId: acceptance.rows[0].request_id
      },
      {
        organizationId: customer.organizationId,
        projectId: customer.projectId,
        caseId: request.caseId,
        customerUserId: customer.userId,
        revisionId: replacement.id,
        revision: 2,
        acceptedBy: customer.userId,
        quoteDigest: replacement.quote_digest,
        disclosureDigest: replacement.disclosure_digest,
        requestId: acceptanceRequestId
      }
    );
    assert.notEqual(
      acceptance.rows[0].accepted_at.toISOString(),
      "2001-01-01T00:00:00.000Z"
    );

    await expectRejected(
      client,
      () =>
        insertRow(client, "service_quote_acceptances", {
          quote_id: quoteId,
          acceptance_statement: "accepted_exact_quote_and_delivery_date",
          accepted_quote_digest: replacement.quote_digest,
          accepted_disclosure_digest: replacement.disclosure_digest,
          request_id: randomUUID()
        }),
      /duplicate key|unique/iu
    );

    await expectRejected(
      client,
      async () => {
        await client.query(
          "update ss.service_cases set state = 'withdrawn' where id = $1",
          [request.caseId]
        );
        await client.query(
          "update ss.service_case_offerings set state = 'removed' where id = $1",
          [request.offeringId]
        );
        await client.query("set constraints all immediate");
      },
      /accepted service quote keeps its submitted request retained/iu
    );

    await setActor(client, "operator", customer, secondOperatorId);
    await expectRejected(
      client,
      () =>
        insertQuoteRevision(client, {
          quoteId,
          intakeId: laterIntake.rows[0].id,
          reviewTargets: ["page:/", "page:/contact", "type:product"],
          operatorUserId: secondOperatorId
        }),
      /lacks current operator authority/iu
    );

    await expectRejected(
      client,
      () =>
        insertRow(client, "service_quote_lines", {
          organization_id: customer.organizationId,
          project_id: customer.projectId,
          quote_id: quoteId,
          quote_revision_id: replacement.id,
          line_number: 1,
          policy_id: ASSESSMENT_POLICY_ID,
          component_key: "website_assessment_standard",
          display_name: "Website assessment",
          line_category: "service",
          quantity: 1,
          unit_label: "assessment",
          unit_amount_minor: 20000,
          customer_amount_minor: 20000,
          provider_direct_amount_minor: 0,
          scope_boundary_digest: replacement.scope_boundary_digest,
          created_at: isoAfter()
        }),
      /permission denied/iu
    );
    await expectRejected(
      client,
      () =>
        client.query(
          "update ss.service_quotes set current_revision = current_revision + 1 where id = $1",
          [quoteId]
        ),
      /permission denied/iu
    );
    await expectRejected(
      client,
      () =>
        client.query("delete from ss.service_quote_acceptances where quote_id = $1", [
          quoteId
        ]),
      /permission denied/iu
    );

    const security = await client.query(`
      select
        relation.relname,
        relation.relrowsecurity,
        relation.relforcerowsecurity,
        has_table_privilege(
          'service_role', format('ss.%I', relation.relname), 'SELECT'
        ) as service_select,
        has_table_privilege(
          'service_role', format('ss.%I', relation.relname), 'INSERT'
        ) as service_insert,
        has_table_privilege(
          'service_role', format('ss.%I', relation.relname), 'UPDATE'
        ) as service_update,
        has_table_privilege(
          'service_role', format('ss.%I', relation.relname), 'DELETE'
        ) as service_delete,
        has_table_privilege(
          'service_role', format('ss.%I', relation.relname), 'TRUNCATE'
        ) as service_truncate,
        has_table_privilege(
          'authenticated', format('ss.%I', relation.relname), 'SELECT'
        ) as authenticated_select,
        has_table_privilege(
          'anon', format('ss.%I', relation.relname), 'INSERT'
        ) as anon_insert
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'ss'
        and relation.relname in (
          'service_operator_authority_events',
          'service_quotes',
          'service_quote_revisions',
          'service_quote_lines',
          'service_quote_line_coverages',
          'service_quote_review_targets',
          'service_quote_installments',
          'service_quote_acceptances',
          'service_invoices',
          'service_invoice_lines',
          'service_payment_reservations'
        )
      order by relation.relname
    `);
    assert.equal(security.rowCount, 11);
    const directlyInsertable = new Set([
      "service_quote_acceptances",
      "service_quote_revisions",
      "service_quotes"
    ]);
    for (const row of security.rows) {
      assert.equal(row.relrowsecurity, true, row.relname);
      assert.equal(row.relforcerowsecurity, true, row.relname);
      assert.equal(row.service_select, true, row.relname);
      assert.equal(
        row.service_insert,
        directlyInsertable.has(row.relname),
        row.relname
      );
      assert.equal(row.service_update, false, row.relname);
      assert.equal(row.service_delete, false, row.relname);
      assert.equal(row.service_truncate, false, row.relname);
      assert.equal(row.authenticated_select, false, row.relname);
      assert.equal(row.anon_insert, false, row.relname);
    }

    const cascadingForeignKeys = await client.query(`
      select constraint_record.conname
        from pg_constraint constraint_record
        join pg_class relation
          on relation.oid = constraint_record.conrelid
        join pg_namespace namespace
          on namespace.oid = relation.relnamespace
       where namespace.nspname = 'ss'
         and relation.relname in (
           'service_operator_authority_events',
           'service_quotes',
           'service_quote_revisions',
           'service_quote_lines',
           'service_quote_line_coverages',
           'service_quote_review_targets',
           'service_quote_installments',
           'service_quote_acceptances'
         )
         and constraint_record.contype = 'f'
         and constraint_record.confdeltype = 'c'
    `);
    assert.deepEqual(cascadingForeignKeys.rows, []);

    await client.query("savepoint authenticated_denial");
    await client.query("set local role authenticated");
    await assert.rejects(
      () => client.query("select * from ss.service_quotes"),
      /permission denied/iu
    );
    await client.query("rollback to savepoint authenticated_denial");

    // Commit only after every retained-data assertion above. The disposable
    // database then supplies two independently locking sessions to prove that
    // same-command replay and provider completion share command-then-attempt
    // lock order instead of deadlocking each other.
    await setActor(client, "customer", customer);
    await client.query(
      `update ss.service_assessment_checkout_attempts
          set state = 'expired'
        where invoice_id = $1 and state = 'ready'`,
      [checkoutInput.invoiceId]
    );
    await client.query("commit");

    const providerEntered = deferred();
    const releaseProvider = deferred();
    const finishEntered = deferred();
    let lockRaceAuthorityCalls = 0;
    let lockRaceProviderCalls = 0;
    const lockRaceCommandId =
      `assessment-lock-order-${randomUUID()}`;
    const lockRaceInput = {
      ...checkoutInput,
      commandId: lockRaceCommandId
    };
    const lockRaceAuthority = {
      async service(context, work) {
        lockRaceAuthorityCalls += 1;
        const transactionClient = await pool.connect();
        try {
          await transactionClient.query("begin");
          await setActor(
            transactionClient,
            context.actorKind,
            {
              ...customer,
              organizationId: context.organizationId
            },
            context.userId
          );
          if (lockRaceAuthorityCalls === 2) {
            const backend = await transactionClient.query(
              "select pg_backend_pid()::int as pid"
            );
            finishEntered.resolve(backend.rows[0].pid);
          }
          const result = await work(transactionClient);
          await transactionClient.query("commit");
          return result;
        } catch (error) {
          await transactionClient.query("rollback").catch(() => {});
          throw error;
        } finally {
          transactionClient.release();
        }
      }
    };
    const lockRacePayment =
      createPostgresCustomServicesAssessmentPayment({
        authority: lockRaceAuthority,
        provider: {
          async createServiceAssessmentCheckout() {
            lockRaceProviderCalls += 1;
            providerEntered.resolve();
            await releaseProvider.promise;
            return {
              checkoutId:
                providerIds.assessmentLockOrder,
              url:
                "https://checkout.stripe.com/c/pay/service_assessment_lock_order",
              expiresAt: isoAfter({ hours: 1 })
            };
          }
        },
        release: APPROVED_ASSESSMENT_PAYMENT_RELEASE
      });
    const lockRaceResultPromise =
      lockRacePayment.createCheckout(lockRaceInput);
    await within(
      providerEntered.promise,
      "assessment lock-order provider was not reached",
      15_000
    );

    await client.query("begin");
    await setActor(client, "customer", customer);
    const lockedCommand = await client.query(
      `select resource_id
         from ss.idempotency_keys
        where organization_id = $1
          and principal_id = $2
          and route_key = 'custom-services.assessment-checkout'
          and idempotency_key = $3
        for update`,
      [
        customer.organizationId,
        customer.userId,
        lockRaceCommandId
      ]
    );
    assert.equal(lockedCommand.rowCount, 1);
    releaseProvider.resolve();
    const finishBackendPid = await within(
      finishEntered.promise,
      "assessment lock-order finish transaction did not start"
    );
    let finishBlockedOnCommand = false;
    for (let observation = 0; observation < 100; observation += 1) {
      const activity = await client.query(
        `select wait_event_type
           from pg_stat_activity
          where pid = $1`,
        [finishBackendPid]
      );
      if (activity.rows[0]?.wait_event_type === "Lock") {
        finishBlockedOnCommand = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(finishBlockedOnCommand, true);
    await client.query("set local lock_timeout = '2s'");
    const unlockedAttempt = await client.query(
      `select state
         from ss.service_assessment_checkout_attempts
        where organization_id = $1 and id = $2
        for update`,
      [customer.organizationId, lockedCommand.rows[0].resource_id]
    );
    assert.deepEqual(unlockedAttempt.rows, [
      { state: "provider_pending" }
    ]);
    await client.query("rollback");

    const lockRaceResult = await within(
      lockRaceResultPromise,
      "assessment lock-order completion did not resume"
    );
    assert.equal(lockRaceResult.state, "ready");
    assert.equal(lockRaceProviderCalls, 1);
    assert.equal(lockRaceAuthorityCalls, 2);
    const lockRaceStored = await client.query(
      `select attempt.state, command.state as command_state
         from ss.service_assessment_checkout_attempts attempt
         join ss.idempotency_keys command
           on command.resource_id = attempt.id
        where attempt.command_id = $1`,
      [lockRaceCommandId]
    );
    assert.deepEqual(lockRaceStored.rows, [
      { state: "ready", command_state: "completed" }
    ]);

    const retainedPurpose = checkoutCalls[0].purpose;
    const retainedPurposeDigest = digest(retainedPurpose);
    const settlementNow = new Date().toISOString();
    const providerPaymentTime = new Date(
      Date.parse(settlementNow) - 1000
    ).toISOString();
    const settlementMetadata = {
      schema: "sitesourcery_service_assessment_checkout_v1",
      tenant_id: retainedPurpose.tenantId,
      customer_id: retainedPurpose.customerId,
      project_id: retainedPurpose.projectId,
      invoice_id: retainedPurpose.invoiceId,
      invoice_number: retainedPurpose.invoiceNumber,
      quote_id: retainedPurpose.quoteId,
      accepted_disclosure_digest:
        retainedPurpose.acceptedDisclosureDigest,
      invoice_digest: retainedPurpose.invoiceDigest,
      purpose_digest: retainedPurposeDigest
    };
    const paymentFacts = {
      schema:
        "sitesourcery.stripe-service-assessment-payment-facts/v1",
      provider: "stripe",
      checkoutSessionId:
        providerIds.assessmentLockOrder,
      paymentIntentId:
        providerIds.assessmentPaymentIntent,
      customerId: providerIds.assessmentStripeCustomer,
      paymentStatus: "paid",
      subtotalMinor: 20000,
      taxMinor: 1450,
      totalMinor: 21450,
      taxMode: "automatic",
      currency: "USD",
      purposeDigest: retainedPurposeDigest,
      providerPaymentTime
    };
    paymentFacts.providerFactsDigest = digest(paymentFacts);
    const settlementEvent = {
      id: providerIds.assessmentSettlementEvent,
      type: "checkout.session.completed",
      livemode: false,
      api_version: "2026-06-24.dahlia",
      created: Math.floor(
        (Date.parse(settlementNow) - 500) / 1000
      ),
      data: {
        object: {
          id: providerIds.assessmentLockOrder,
          metadata: settlementMetadata
        }
      }
    };
    const settlementAuthority = {
      async service(context, work) {
        const transactionClient = await pool.connect();
        try {
          await transactionClient.query("begin");
          await setActor(
            transactionClient,
            context.actorKind,
            {
              ...customer,
              organizationId: context.organizationId
            },
            context.userId ?? customer.userId
          );
          const result = await work(transactionClient);
          await transactionClient.query("commit");
          return result;
        } catch (error) {
          await transactionClient.query("rollback").catch(() => {});
          throw error;
        } finally {
          transactionClient.release();
        }
      }
    };
    let settlementReadCalls = 0;
    let returnPermanentMismatch = true;
    let failReadOnce = true;
    const settlementProvider = {
      async retrieveServiceAssessmentPayment(input) {
        settlementReadCalls += 1;
        assert.deepEqual(input, {
          checkoutSessionId:
            providerIds.assessmentLockOrder,
          purpose: retainedPurpose,
          purposeDigest: retainedPurposeDigest
        });
        if (returnPermanentMismatch) {
          returnPermanentMismatch = false;
          const mismatched = {
            ...paymentFacts,
            totalMinor: 21449
          };
          delete mismatched.providerFactsDigest;
          mismatched.providerFactsDigest = digest(mismatched);
          return mismatched;
        }
        if (failReadOnce) {
          failReadOnce = false;
          const error = new Error("readback temporarily unavailable");
          error.code = "stripe_service_assessment_payment_read_unavailable";
          throw error;
        }
        return structuredClone(paymentFacts);
      },
      async retrieveServiceAssessmentCheckoutLifecycle() {
        throw new Error("settlement must not use lifecycle readback");
      }
    };
    const settlement =
      createPostgresCustomServicesAssessmentSettlement({
        authority: settlementAuthority,
        provider: settlementProvider,
        clock: { now: () => settlementNow },
        ids: { next: () => randomUUID() }
      });
    assert.deepEqual(await settlement.readiness(), {
      schema:
        "sitesourcery.custom-services-assessment-settlement-readiness/v1",
      ready: true,
      webhookWakeup: true,
      stripeReadback: true,
      atomicSettlement: true
    });
    const mismatchEvent = {
      ...settlementEvent,
      id: providerIds.assessmentMismatchEvent
    };
    assert.deepEqual(
      await settlement.ingestStripeEvent(mismatchEvent),
      {
        schema:
          "sitesourcery.custom-services-assessment-reconciliation/v1",
        status: "reconciliation_required",
        projectId: customer.projectId,
        invoiceId: retainedPurpose.invoiceId,
        next: "manual_review"
      }
    );
    assert.deepEqual(
      await settlement.ingestStripeEvent(mismatchEvent),
      {
        schema:
          "sitesourcery.custom-services-assessment-reconciliation/v1",
        status: "reconciliation_required",
        projectId: customer.projectId,
        invoiceId: retainedPurpose.invoiceId,
        next: "manual_review"
      }
    );
    assert.equal(settlementReadCalls, 1);
    const attentionInvoiceProjection =
      await invoiceRepository.readCurrentInvoice(quoteScope);
    assert.equal(
      attentionInvoiceProjection.state,
      "payment_attention"
    );
    assert.equal(
      attentionInvoiceProjection.invoice.payment.chargeOccurred,
      null
    );
    assert.equal(
      attentionInvoiceProjection.actions.checkout.reason,
      "payment_attention"
    );
    await assert.rejects(
      settlement.ingestStripeEvent(settlementEvent),
      (error) =>
        error.code ===
          "ASSESSMENT_PAYMENT_RECONCILIATION_UNAVAILABLE" &&
        error.status === 503
    );
    const verifyingInvoiceProjection =
      await invoiceRepository.readCurrentInvoice(quoteScope);
    assert.equal(
      verifyingInvoiceProjection.state,
      "payment_verifying"
    );
    assert.equal(
      verifyingInvoiceProjection.invoice.payment.chargeOccurred,
      null
    );
    assert.equal(
      verifyingInvoiceProjection.actions.checkout.reason,
      "payment_verifying"
    );
    let settlementCounts = await pool.query(
      `select
         (select count(*)::int
            from ss.service_assessment_stripe_events
           where id = $1 and state = 'pending') as pending_events,
         (select count(*)::int
            from ss.service_assessment_payment_receipts
           where invoice_id = $2) as receipts,
         (select count(*)::int
            from ss.service_assessment_jobs
           where invoice_id = $2) as jobs`,
      [settlementEvent.id, retainedPurpose.invoiceId]
    );
    assert.deepEqual(settlementCounts.rows[0], {
      pending_events: 1,
      receipts: 0,
      jobs: 0
    });

    const settled =
      await settlement.ingestStripeEvent(settlementEvent);
    assert.equal(settled.status, "payment_settled");
    assert.equal(settled.projectId, customer.projectId);
    assert.equal(settled.invoiceId, retainedPurpose.invoiceId);
    assert.equal(settled.next, "assessment_work");
    assert.match(settled.receiptId, /^[0-9a-f-]{36}$/u);
    assert.match(settled.jobId, /^[0-9a-f-]{36}$/u);
    const paidInvoiceProjection =
      await invoiceRepository.readCurrentInvoice(quoteScope);
    assert.equal(paidInvoiceProjection.state, "paid_job_open");
    assert.equal(
      paidInvoiceProjection.invoice.payment.chargeOccurred,
      true
    );
    assert.equal(
      paidInvoiceProjection.invoice.payment.receiptId,
      settled.receiptId
    );
    assert.equal(paidInvoiceProjection.invoice.tax.amountMinor, 1450);
    assert.equal(paidInvoiceProjection.invoice.total.amountMinor, 21450);
    assert.equal(paidInvoiceProjection.job.jobId, settled.jobId);
    assert.equal(paidInvoiceProjection.job.state, "open");
    assert.equal(
      paidInvoiceProjection.actions.checkout.reason,
      "already_paid"
    );
    const checkoutCallsBeforePaidReplay = checkoutCalls.length;
    await assert.rejects(
      assessmentPayment.createCheckout(checkoutInput),
      (error) => error.code === "ASSESSMENT_INVOICE_ALREADY_PAID"
    );
    assert.equal(checkoutCalls.length, checkoutCallsBeforePaidReplay);
    assert.deepEqual(
      await settlement.ingestStripeEvent(settlementEvent),
      settled
    );
    assert.equal(settlementReadCalls, 3);

    const aliasEvent = {
      ...settlementEvent,
      id: providerIds.assessmentSettlementEventAlias
    };
    assert.deepEqual(
      await settlement.ingestStripeEvent(aliasEvent),
      settled
    );
    assert.equal(settlementReadCalls, 4);
    settlementCounts = await pool.query(
      `select
         (select count(*)::int
            from ss.service_assessment_stripe_events
           where checkout_session_id = $1
             and state = 'processed') as processed_events,
         (select count(*)::int
            from ss.service_assessment_stripe_events
           where checkout_session_id = $1
             and state = 'reconciliation_required')
           as reconciliation_events,
         (select count(*)::int
            from ss.service_assessment_payment_receipts
           where invoice_id = $2
             and subtotal_minor = 20000
             and tax_minor = 1450
             and total_minor = 21450) as receipts,
         (select count(*)::int
            from ss.service_assessment_jobs
           where invoice_id = $2
             and state = 'open'
             and maximum_websites = 1
             and maximum_representative_pages_or_types = 5
             and maximum_findings = 10
             and desktop_review_included
             and phone_review_included) as jobs`,
      [
        providerIds.assessmentLockOrder,
        retainedPurpose.invoiceId
      ]
    );
    assert.deepEqual(settlementCounts.rows[0], {
      processed_events: 2,
      reconciliation_events: 1,
      receipts: 1,
      jobs: 1
    });

    const foreignEvent = structuredClone(settlementEvent);
    foreignEvent.id = providerIds.assessmentForeignEvent;
    foreignEvent.data.object.metadata.tenant_id = randomUUID();
    await assert.rejects(
      settlement.ingestStripeEvent(foreignEvent),
      (error) =>
        error.code === "STRIPE_EVENT_BINDING_INVALID"
    );
    assert.equal(settlementReadCalls, 4);

    const assessmentWorkAuthority = {
      async service(context, work) {
        const transactionClient = await pool.connect();
        try {
          await transactionClient.query("begin");
          await transactionClient.query("set local role service_role");
          const operatorContext = context.userId === secondOperatorId;
          await setActor(
            transactionClient,
            operatorContext ? "operator" : "customer",
            {
              organizationId:
                context.organizationId ??
                (operatorContext ? undefined : customer.organizationId)
            },
            context.userId
          );
          const result = await work(transactionClient);
          await transactionClient.query("commit");
          return result;
        } catch (error) {
          await transactionClient.query("rollback").catch(() => {});
          throw error;
        } finally {
          transactionClient.release();
        }
      }
    };
    const assessmentWork = createPostgresCustomServicesAssessmentWork({
      authority: assessmentWorkAuthority,
      clock: { now: () => settlementNow },
      randomUUID
    });
    const operatorActor = { userId: secondOperatorId };
    const openJobs = await assessmentWork.listJobs(operatorActor);
    assert.equal(
      openJobs.schema,
      "sitesourcery.custom-services-owner-assessment-jobs/v1"
    );
    const paidJob = openJobs.jobs.find(
      (job) => job.jobId === settled.jobId
    );
    assert.ok(paidJob);
    assert.equal(paidJob.state, "open");
    assert.deepEqual(paidJob.scope.reviewTargets, [
      { kind: "page", value: "/" },
      { kind: "page_type", value: "product" }
    ]);
    assert.deepEqual(paidJob.scope.requiredViewports, [
      "desktop",
      "phone"
    ]);
    assert.equal(paidJob.scope.maximumFindings, 10);
    assert.deepEqual(paidJob.evidence, []);
    assert.deepEqual(paidJob.findings, []);
    assert.equal(paidJob.delivery, null);

    const evidenceBytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64"
    );
    const staleDesktopInput = {
      accessibleDescription:
        "Earlier desktop capture of the paid home-page review target.",
      bytesBase64: evidenceBytes.toString("base64"),
      commandId: `assessment-evidence-${randomUUID()}`,
      mediaType: "image/png",
      organizationId: customer.organizationId,
      reviewTarget: paidJob.scope.reviewTargets[0],
      viewport: "desktop"
    };
    const staleDesktop = await assessmentWork.uploadEvidence(
      operatorActor,
      paidJob.jobId,
      staleDesktopInput
    );
    assert.deepEqual(
      await assessmentWork.uploadEvidence(
        operatorActor,
        paidJob.jobId,
        staleDesktopInput
      ),
      staleDesktop
    );
    await assert.rejects(
      assessmentWork.uploadEvidence(operatorActor, paidJob.jobId, {
        ...staleDesktopInput,
        accessibleDescription:
          "Conflicting details for a command that already stored evidence."
      }),
      (error) => error.code === "idempotency_conflict"
    );
    const oneEvidenceJobs = await assessmentWork.listJobs(operatorActor);
    const oneEvidenceJob = oneEvidenceJobs.jobs.find(
      (job) => job.jobId === paidJob.jobId
    );
    assert.ok(oneEvidenceJob);
    await assert.rejects(
      assessmentWork.deliverReport(operatorActor, paidJob.jobId, {
        commandId: `assessment-delivery-${randomUUID()}`,
        expectedWorkDigest: oneEvidenceJob.workDigest,
        organizationId: customer.organizationId,
        overallSummary:
          "This assessment cannot be delivered until every paid target has desktop and phone proof."
      }),
      (error) => error.code === "ASSESSMENT_COVERAGE_INCOMPLETE"
    );

    const selectedEvidence = new Map();
    for (const reviewTarget of paidJob.scope.reviewTargets) {
      for (const selectedViewport of ["desktop", "phone"]) {
        const evidenceInput = {
          accessibleDescription:
            `Current ${selectedViewport} capture for ${reviewTarget.kind} ${reviewTarget.value}.`,
          bytesBase64: evidenceBytes.toString("base64"),
          commandId: `assessment-evidence-${randomUUID()}`,
          mediaType: "image/png",
          organizationId: customer.organizationId,
          reviewTarget,
          viewport: selectedViewport
        };
        const receipt = await assessmentWork.uploadEvidence(
          operatorActor,
          paidJob.jobId,
          evidenceInput
        );
        assert.equal(receipt.evidence.mediaType, "image/png");
        assert.equal(receipt.evidence.byteCount, evidenceBytes.byteLength);
        selectedEvidence.set(
          `${reviewTarget.kind}:${reviewTarget.value}:${selectedViewport}`,
          receipt.evidence
        );
      }
    }
    const firstDesktop = selectedEvidence.get("page:/:desktop");
    const firstPhone = selectedEvidence.get("page:/:phone");
    const productDesktop = selectedEvidence.get(
      "page_type:product:desktop"
    );
    assert.ok(firstDesktop);
    assert.ok(firstPhone);
    assert.ok(productDesktop);

    await assert.rejects(
      assessmentWork.putFinding(operatorActor, paidJob.jobId, 1, {
        category: "responsive_design",
        commandId: `assessment-finding-${randomUUID()}`,
        evidenceIds: [productDesktop.evidenceId],
        expectedRevision: 0,
        included: true,
        organizationId: customer.organizationId,
        primaryTarget: paidJob.scope.reviewTargets[0],
        recommendation:
          "Use evidence from the same paid target before saving this finding.",
        severity: "moderate",
        summary: "The finding cannot cite evidence from another target.",
        viewports: ["desktop"]
      }),
      (error) => error.code === "ASSESSMENT_WORK_CHANGED"
    );

    const findingInput = {
      category: "responsive_design",
      commandId: `assessment-finding-${randomUUID()}`,
      evidenceIds: [firstPhone.evidenceId, firstDesktop.evidenceId],
      expectedRevision: 0,
      included: true,
      organizationId: customer.organizationId,
      primaryTarget: paidJob.scope.reviewTargets[0],
      recommendation:
        "Increase spacing and preserve the primary action across desktop and phone layouts.",
      severity: "moderate",
      summary: "The primary action loses emphasis in the crowded phone layout.",
      viewports: ["phone", "desktop"]
    };
    const firstFinding = await assessmentWork.putFinding(
      operatorActor,
      paidJob.jobId,
      1,
      findingInput
    );
    assert.equal(firstFinding.finding.revision, 1);
    assert.deepEqual(
      await assessmentWork.putFinding(
        operatorActor,
        paidJob.jobId,
        1,
        findingInput
      ),
      firstFinding
    );
    const revisedFindingInput = {
      ...findingInput,
      commandId: `assessment-finding-${randomUUID()}`,
      expectedRevision: 1,
      recommendation:
        "Increase spacing, shorten the supporting copy, and preserve the primary action across desktop and phone layouts."
    };
    const revisedFinding = await assessmentWork.putFinding(
      operatorActor,
      paidJob.jobId,
      1,
      revisedFindingInput
    );
    assert.equal(revisedFinding.finding.revision, 2);
    assert.deepEqual(
      await assessmentWork.putFinding(
        operatorActor,
        paidJob.jobId,
        1,
        revisedFindingInput
      ),
      revisedFinding
    );

    const readyJobs = await assessmentWork.listJobs(operatorActor);
    const readyJob = readyJobs.jobs.find(
      (job) => job.jobId === paidJob.jobId
    );
    assert.ok(readyJob);
    assert.notEqual(readyJob.workDigest, paidJob.workDigest);
    await assert.rejects(
      assessmentWork.deliverReport(operatorActor, paidJob.jobId, {
        commandId: `assessment-delivery-${randomUUID()}`,
        expectedWorkDigest: paidJob.workDigest,
        organizationId: customer.organizationId,
        overallSummary:
          "This stale delivery must not freeze work that was not reviewed."
      }),
      (error) => error.code === "ASSESSMENT_WORK_CHANGED"
    );
    const deliveryInput = {
      commandId: `assessment-delivery-${randomUUID()}`,
      expectedWorkDigest: readyJob.workDigest,
      organizationId: customer.organizationId,
      overallSummary:
        "The paid targets are functional, with the clearest opportunity being stronger phone hierarchy and primary-action emphasis."
    };
    const delivery = await assessmentWork.deliverReport(
      operatorActor,
      paidJob.jobId,
      deliveryInput
    );
    assert.equal(delivery.state, "delivered");
    assert.equal(delivery.findingCount, 1);
    assert.equal(delivery.credit.amountMinor, 20000);
    assert.equal(delivery.credit.currency, "USD");
    assert.equal(delivery.credit.applicationScope, "custom_base_build");
    assert.equal(delivery.credit.maximumApplications, 1);
    assert.equal(delivery.credit.nonCash, true);
    const expectedCreditCutoff = await pool.query(
      "select $1::timestamptz + interval '90 days' as cutoff",
      [delivery.deliveredAt]
    );
    assert.equal(
      delivery.credit.acceptanceCutoff,
      expectedCreditCutoff.rows[0].cutoff.toISOString()
    );
    assert.deepEqual(
      await assessmentWork.deliverReport(
        operatorActor,
        paidJob.jobId,
        deliveryInput
      ),
      delivery
    );
    await assert.rejects(
      assessmentWork.deliverReport(operatorActor, paidJob.jobId, {
        ...deliveryInput,
        commandId: `assessment-delivery-${randomUUID()}`,
        overallSummary:
          "A different summary cannot claim success after immutable delivery."
      }),
      (error) => error.code === "ASSESSMENT_ALREADY_DELIVERED"
    );

    const deliveredJobs = await assessmentWork.listJobs(operatorActor);
    const deliveredJob = deliveredJobs.jobs.find(
      (job) => job.jobId === paidJob.jobId
    );
    assert.equal(deliveredJob.state, "delivered");
    assert.equal(deliveredJob.evidence.length, 5);
    assert.equal(deliveredJob.findings.length, 1);
    assert.equal(deliveredJob.findings[0].revision, 2);
    assert.equal(deliveredJob.delivery.reportId, delivery.reportId);

    const ownerEvidence = await assessmentWork.readOwnerEvidence(
      operatorActor,
      paidJob.jobId,
      firstDesktop.evidenceId
    );
    assert.deepEqual(ownerEvidence.bytes, evidenceBytes);
    assert.equal(ownerEvidence.mediaType, "image/png");

    const customerAssessmentScope = {
      actorId: customer.userId,
      customerId: customer.userId,
      organizationId: customer.organizationId,
      projectId: customer.projectId
    };
    const customerReport = await assessmentWork.readCustomerReport(
      customerAssessmentScope
    );
    assert.equal(customerReport.state, "delivered");
    assert.equal(customerReport.job.jobId, paidJob.jobId);
    assert.equal(customerReport.report.reportId, delivery.reportId);
    assert.equal(customerReport.report.findings.length, 1);
    assert.equal(customerReport.report.findings[0].revision, 2);
    assert.equal(
      customerReport.report.findings[0].recommendation,
      revisedFindingInput.recommendation
    );
    assert.equal(customerReport.credit.creditId, delivery.credit.creditId);
    const customerEvidence = await assessmentWork.readCustomerEvidence(
      customerAssessmentScope,
      firstDesktop.evidenceId
    );
    assert.deepEqual(customerEvidence.bytes, evidenceBytes);
    await assert.rejects(
      assessmentWork.readCustomerEvidence(
        customerAssessmentScope,
        staleDesktop.evidence.evidenceId
      ),
      (error) => error.code === "ASSESSMENT_EVIDENCE_UNAVAILABLE"
    );
    await assert.rejects(
      assessmentWork.readCustomerReport({
        ...customerAssessmentScope,
        actorId: other.userId
      }),
      (error) => error.code === "project_unavailable"
    );

    let customBuildCapture = null;
    let customBuildTransactionId = 0;
    const beginCustomBuildCapture = (onQuery = null) => {
      assert.equal(
        customBuildCapture,
        null,
        "Custom-build query captures must not overlap"
      );
      const capture = {
        entries: [],
        onQuery
      };
      customBuildCapture = capture;
      return Object.freeze({
        entries: capture.entries,
        stop() {
          assert.equal(customBuildCapture, capture);
          customBuildCapture = null;
        }
      });
    };
    const customBuildAuthority = {
      async service(context, work) {
        const transactionClient = await pool.connect();
        const transactionId = ++customBuildTransactionId;
        try {
          await transactionClient.query("begin");
          await transactionClient.query("set local role service_role");
          if (context.actorKind === "system") {
            await setActor(
              transactionClient,
              "system",
              {
                organizationId:
                  context.organizationId ?? customer.organizationId,
                userId: customer.userId
              },
              customer.userId
            );
          } else if (context.userId) {
            await setActor(
              transactionClient,
              [secondOperatorId, thirdOperatorId].includes(context.userId)
                ? "operator"
                : "customer",
              {
                organizationId:
                  context.organizationId ?? customer.organizationId
              },
              context.userId
            );
          }
          const backend = await transactionClient.query(
            "select pg_backend_pid()::int as pid"
          );
          const backendPid = backend.rows[0].pid;
          const result = await work({
            query(text, values = []) {
              const active = customBuildCapture;
              if (active !== null) {
                const entry = Object.freeze({
                  backendPid,
                  sql: normalizedSql(text),
                  transactionId,
                  values: structuredClone(values)
                });
                active.entries.push(entry);
                active.onQuery?.(entry);
              }
              return transactionClient.query(text, values);
            }
          });
          await transactionClient.query("commit");
          return result;
        } catch (error) {
          await transactionClient.query("rollback").catch(() => {});
          throw error;
        } finally {
          transactionClient.release();
        }
      }
    };
    const customBuild = createPostgresCustomServicesCustomBuild({
      authority: customBuildAuthority,
      randomUUID
    });
    assert.deepEqual(await customBuild.readiness(), {
      schema: "sitesourcery.custom-services-custom-build-readiness/v1",
      ready: true,
      runtimeContract: "canonical-ss-v41-custom-build-quote-credit"
    });

    const opportunities = await customBuild.listOpportunities(operatorActor);
    assert.equal(
      opportunities.schema,
      "sitesourcery.custom-services-owner-custom-build-opportunities/v1"
    );
    const opportunity = opportunities.opportunities.find(
      (entry) => entry.assessment.jobId === paidJob.jobId
    );
    assert.ok(opportunity);
    assert.equal(opportunity.credit.amountMinor, 20000);
    assert.equal(opportunity.credit.state, "available");
    assert.equal(opportunity.currentQuote, null);

    const customBuildIssue = {
      commandId: `custom-build-issue-${randomUUID()}`,
      organizationId: customer.organizationId,
      tierId: "site",
      craftedPages: 4,
      sections: 16,
      uniqueLayouts: 4,
      contentWords: 1800,
      suppliedMedia: 12,
      scopeStatement:
        "Build the four reviewed public pages with the agreed essential design scope.",
      targetCompletionDate: dateAfter(45),
      expiresAt: isoAfter({ days: 14 })
    };
    await assert.rejects(
      customBuild.issueQuote(operatorActor, paidJob.jobId, {
        ...customBuildIssue,
        serviceAmountMinor: 1
      }),
      (error) => error.code === "invalid_input"
    );
    const issuedBuild = await customBuild.issueQuote(
      operatorActor,
      paidJob.jobId,
      customBuildIssue
    );
    assert.equal(
      issuedBuild.schema,
      "sitesourcery.custom-services-owner-custom-build-quote/v1"
    );
    assert.equal(issuedBuild.state, "issued");
    assert.equal(issuedBuild.quote.tier.id, "site");
    assert.equal(issuedBuild.quote.pricing.serviceAmountMinor, 120000);
    assert.equal(issuedBuild.quote.pricing.creditAmountMinor, 20000);
    assert.equal(issuedBuild.quote.pricing.customerAmountMinor, 100000);
    assert.equal(issuedBuild.quote.pricing.startValueMinor, 60000);
    assert.equal(issuedBuild.quote.pricing.startCreditMinor, 20000);
    assert.equal(issuedBuild.quote.pricing.startDueMinor, 40000);
    assert.equal(issuedBuild.quote.pricing.finalDueMinor, 60000);
    assert.deepEqual(
      issuedBuild.quote.pricing.installments.map((entry) => ({
        number: entry.number,
        amountDueMinor: entry.amountDueMinor,
        dueTrigger: entry.dueTrigger
      })),
      [
        { number: 1, amountDueMinor: 40000, dueTrigger: "before_work" },
        { number: 2, amountDueMinor: 60000, dueTrigger: "before_handoff" }
      ]
    );
    assert.deepEqual(
      await customBuild.issueQuote(
        operatorActor,
        paidJob.jobId,
        customBuildIssue
      ),
      issuedBuild
    );
    await assert.rejects(
      customBuild.issueQuote(operatorActor, paidJob.jobId, {
        ...customBuildIssue,
        scopeStatement:
          "A conflicting scope must never reuse the first quote command identity."
      }),
      (error) => error.code === "idempotency_conflict"
    );

    const customerBuildIssued = await customBuild.readCurrentQuote(
      customerAssessmentScope
    );
    assert.equal(customerBuildIssued.state, "issued");
    assert.equal(
      customerBuildIssued.quote.quoteDigest,
      issuedBuild.quote.quoteDigest
    );
    await assert.rejects(
      customBuild.acceptCurrentQuote({
        ...customerAssessmentScope,
        acceptanceStatement: "accepted_exact_custom_build_quote",
        acceptedDisclosureDigest:
          customerBuildIssued.quote.disclosureDigest,
        acceptedQuoteDigest: customerBuildIssued.quote.quoteDigest,
        commandId: `custom-build-accept-${randomUUID()}`,
        quoteId: customerBuildIssued.quote.quoteId,
        quoteRevision: customerBuildIssued.quote.quoteRevision + 1
      }),
      (error) => error.code === "custom_build_changed"
    );
    const customBuildAcceptanceCommandId =
      `custom-build-accept-${randomUUID()}`;
    const acceptedBuild = await customBuild.acceptCurrentQuote({
      ...customerAssessmentScope,
      acceptanceStatement: "accepted_exact_custom_build_quote",
      acceptedDisclosureDigest: customerBuildIssued.quote.disclosureDigest,
      acceptedQuoteDigest: customerBuildIssued.quote.quoteDigest,
      commandId: customBuildAcceptanceCommandId,
      quoteId: customerBuildIssued.quote.quoteId,
      quoteRevision: customerBuildIssued.quote.quoteRevision
    });
    assert.equal(acceptedBuild.state, "accepted");
    assert.equal(acceptedBuild.credit.state, "reserved");
    assert.equal(
      acceptedBuild.quote.acceptance.acceptedQuoteDigest,
      acceptedBuild.quote.quoteDigest
    );
    assert.equal(
      (await assessmentWork.readCustomerReport(
        customerAssessmentScope
      )).credit.state,
      "reserved"
    );
    assert.deepEqual(
      await customBuild.acceptCurrentQuote({
        ...customerAssessmentScope,
        acceptanceStatement: "accepted_exact_custom_build_quote",
        acceptedDisclosureDigest: customerBuildIssued.quote.disclosureDigest,
        acceptedQuoteDigest: customerBuildIssued.quote.quoteDigest,
        commandId: customBuildAcceptanceCommandId,
        quoteId: customerBuildIssued.quote.quoteId,
        quoteRevision: customerBuildIssued.quote.quoteRevision
      }),
      acceptedBuild
    );

    // The second customer is a durable, disjoint Site-build fixture for the
    // final-settlement-versus-handoff race. It lets the real PostgreSQL
    // sessions commit their effects without changing the original customer's
    // quote-void and Card Plus zero-balance journey below.
    const raceAssessmentScope = {
      actorId: other.userId,
      customerId: other.userId,
      organizationId: other.organizationId,
      projectId: other.projectId
    };
    const raceAssessmentAuthority = {
      async service(context, work) {
        const transactionClient = await pool.connect();
        try {
          await transactionClient.query("begin");
          await transactionClient.query("set local role service_role");
          const selectedActorKind =
            context.actorKind ??
            (context.userId === secondOperatorId
              ? "operator"
              : "customer");
          const selectedUserId =
            context.userId ?? other.userId;
          await setActor(
            transactionClient,
            selectedActorKind,
            {
              organizationId:
                context.organizationId ?? other.organizationId,
              userId: selectedUserId
            },
            selectedUserId
          );
          const result = await work(transactionClient);
          await transactionClient.query("commit");
          return result;
        } catch (error) {
          await transactionClient.query("rollback").catch(() => {});
          throw error;
        } finally {
          transactionClient.release();
        }
      }
    };
    const raceQuoteRepository =
      createPostgresCustomServicesAssessmentQuoteRepository({
        authority: raceAssessmentAuthority
      });
    const raceQuoteSnapshot =
      await raceQuoteRepository.readCurrentQuote(raceAssessmentScope);
    const raceQuoteProjection = projectCustomServicesAssessmentQuote({
      scope: raceAssessmentScope,
      snapshot: raceQuoteSnapshot
    });
    assert.equal(raceQuoteProjection.state, "review_required");
    await raceQuoteRepository.acceptCurrentQuote({
      ...raceAssessmentScope,
      acceptanceStatement: "accepted_exact_quote_and_delivery_date",
      acceptedDisclosureDigest:
        raceQuoteProjection.quote.disclosureDigest,
      acceptedQuoteDigest: raceQuoteProjection.quote.quoteDigest,
      commandId: `v47-race-assessment-accept-${randomUUID()}`,
      quoteId: raceQuoteProjection.quote.quoteId,
      quoteRevision: raceQuoteProjection.quote.revision
    });
    const raceInvoiceRepository =
      createPostgresCustomServicesInvoiceRepository({
        authority: raceAssessmentAuthority,
        release: APPROVED_ASSESSMENT_PAYMENT_RELEASE
      });
    const raceAssessmentInvoice =
      await raceInvoiceRepository.readCurrentInvoice(raceAssessmentScope);
    let raceAssessmentPurpose = null;
    const raceAssessmentSessionId =
      `cs_test_v47_race_assessment_${randomUUID().replaceAll("-", "_")}`;
    const raceAssessmentPaymentIntentId =
      `pi_test_v47_race_assessment_${randomUUID().replaceAll("-", "_")}`;
    const raceAssessmentStripeCustomerId = foreignFinalStripeCustomerId;
    const raceAssessmentEventId =
      `evt_test_v47_race_assessment_${randomUUID().replaceAll("-", "_")}`;
    const raceAssessmentPayment =
      createPostgresCustomServicesAssessmentPayment({
        authority: raceAssessmentAuthority,
        provider: {
          async createServiceAssessmentCheckout(input) {
            raceAssessmentPurpose = structuredClone(input.purpose);
            return {
              checkoutId: raceAssessmentSessionId,
              url:
                "https://checkout.stripe.com/c/pay/v47_race_assessment",
              expiresAt: isoAfter({ hours: 1 })
            };
          }
        },
        release: APPROVED_ASSESSMENT_PAYMENT_RELEASE
      });
    await raceAssessmentPayment.createCheckout({
      ...raceAssessmentScope,
      commandId: `v47-race-assessment-checkout-${randomUUID()}`,
      invoiceId: raceAssessmentInvoice.invoice.invoiceId,
      invoiceDigest: raceAssessmentInvoice.invoice.invoiceDigest
    });
    assert.ok(raceAssessmentPurpose);
    const raceAssessmentPurposeDigest = digest(raceAssessmentPurpose);
    const raceAssessmentSettledAt = new Date().toISOString();
    const raceAssessmentProviderPaidAt = new Date(
      Date.parse(raceAssessmentSettledAt) - 1000
    ).toISOString();
    const raceAssessmentPaymentFacts = {
      schema:
        "sitesourcery.stripe-service-assessment-payment-facts/v1",
      provider: "stripe",
      checkoutSessionId: raceAssessmentSessionId,
      paymentIntentId: raceAssessmentPaymentIntentId,
      customerId: raceAssessmentStripeCustomerId,
      paymentStatus: "paid",
      subtotalMinor: 20000,
      taxMinor: 1600,
      totalMinor: 21600,
      taxMode: "automatic",
      currency: "USD",
      purposeDigest: raceAssessmentPurposeDigest,
      providerPaymentTime: raceAssessmentProviderPaidAt
    };
    raceAssessmentPaymentFacts.providerFactsDigest = digest(
      raceAssessmentPaymentFacts
    );
    const raceAssessmentSettlement =
      createPostgresCustomServicesAssessmentSettlement({
        authority: raceAssessmentAuthority,
        provider: {
          async retrieveServiceAssessmentPayment() {
            return structuredClone(raceAssessmentPaymentFacts);
          },
          async retrieveServiceAssessmentCheckoutLifecycle() {
            throw new Error(
              "v47 race assessment settlement must use payment readback"
            );
          }
        },
        clock: { now: () => raceAssessmentSettledAt },
        ids: { next: () => randomUUID() }
      });
    const raceAssessmentSettlementReceipt =
      await raceAssessmentSettlement.ingestStripeEvent({
        id: raceAssessmentEventId,
        type: "checkout.session.completed",
        livemode: false,
        api_version: "2026-06-24.dahlia",
        created: Math.floor(
          (Date.parse(raceAssessmentSettledAt) - 500) / 1000
        ),
        data: {
          object: {
            id: raceAssessmentSessionId,
            metadata: {
              schema: "sitesourcery_service_assessment_checkout_v1",
              tenant_id: raceAssessmentPurpose.tenantId,
              customer_id: raceAssessmentPurpose.customerId,
              project_id: raceAssessmentPurpose.projectId,
              invoice_id: raceAssessmentPurpose.invoiceId,
              invoice_number: raceAssessmentPurpose.invoiceNumber,
              quote_id: raceAssessmentPurpose.quoteId,
              accepted_disclosure_digest:
                raceAssessmentPurpose.acceptedDisclosureDigest,
              invoice_digest: raceAssessmentPurpose.invoiceDigest,
              purpose_digest: raceAssessmentPurposeDigest
            }
          }
        }
      });
    assert.equal(
      raceAssessmentSettlementReceipt.status,
      "payment_settled"
    );
    const raceAssessmentWork =
      createPostgresCustomServicesAssessmentWork({
        authority: raceAssessmentAuthority,
        clock: { now: () => raceAssessmentSettledAt },
        randomUUID
      });
    const raceAssessmentJobs =
      await raceAssessmentWork.listJobs(operatorActor);
    const raceAssessmentJob = raceAssessmentJobs.jobs.find(
      (entry) => entry.jobId === raceAssessmentSettlementReceipt.jobId
    );
    assert.ok(raceAssessmentJob);
    for (const reviewTarget of raceAssessmentJob.scope.reviewTargets) {
      for (const viewport of ["desktop", "phone"]) {
        await raceAssessmentWork.uploadEvidence(
          operatorActor,
          raceAssessmentJob.jobId,
          {
            accessibleDescription:
              `V47 race fixture ${viewport} proof for ` +
              `${reviewTarget.kind} ${reviewTarget.value}.`,
            bytesBase64: evidenceBytes.toString("base64"),
            commandId: `v47-race-assessment-evidence-${randomUUID()}`,
            mediaType: "image/png",
            organizationId: other.organizationId,
            reviewTarget,
            viewport
          }
        );
      }
    }
    const raceAssessmentReadyJobs =
      await raceAssessmentWork.listJobs(operatorActor);
    const raceAssessmentReadyJob = raceAssessmentReadyJobs.jobs.find(
      (entry) => entry.jobId === raceAssessmentJob.jobId
    );
    assert.ok(raceAssessmentReadyJob);
    const raceAssessmentDelivery =
      await raceAssessmentWork.deliverReport(
        operatorActor,
        raceAssessmentJob.jobId,
        {
          commandId: `v47-race-assessment-delivery-${randomUUID()}`,
          expectedWorkDigest: raceAssessmentReadyJob.workDigest,
          organizationId: other.organizationId,
          overallSummary:
            "The isolated V47 Site-build fixture has complete desktop and phone assessment evidence."
        }
      );
    assert.equal(raceAssessmentDelivery.credit.amountMinor, 20000);

    const raceBuildIssue = {
      commandId: `v47-race-custom-build-issue-${randomUUID()}`,
      organizationId: other.organizationId,
      tierId: "site",
      craftedPages: 4,
      sections: 16,
      uniqueLayouts: 4,
      contentWords: 1800,
      suppliedMedia: 12,
      scopeStatement:
        "Build the isolated four-page Site fixture for the final settlement and handoff race.",
      targetCompletionDate: dateAfter(45),
      expiresAt: isoAfter({ days: 14 })
    };
    const raceIssuedBuild = await customBuild.issueQuote(
      operatorActor,
      raceAssessmentJob.jobId,
      raceBuildIssue
    );
    const raceCustomerBuildIssued = await customBuild.readCurrentQuote(
      raceAssessmentScope
    );
    const raceAcceptedBuild = await customBuild.acceptCurrentQuote({
      ...raceAssessmentScope,
      acceptanceStatement: "accepted_exact_custom_build_quote",
      acceptedDisclosureDigest:
        raceCustomerBuildIssued.quote.disclosureDigest,
      acceptedQuoteDigest: raceCustomerBuildIssued.quote.quoteDigest,
      commandId: `v47-race-custom-build-accept-${randomUUID()}`,
      quoteId: raceCustomerBuildIssued.quote.quoteId,
      quoteRevision: raceCustomerBuildIssued.quote.quoteRevision
    });
    assert.equal(raceIssuedBuild.quote.pricing.finalDueMinor, 60000);
    assert.equal(raceAcceptedBuild.state, "accepted");
    const positiveDigestForeignCustomerId = customer.userId;
    assert.notEqual(
      positiveDigestForeignCustomerId,
      other.userId,
      "positive final-obligation digest proof requires distinct customers"
    );

    // Materialize this disjoint positive Site path, commit its pending final
    // evidence, then coordinate its settlement and handoff from independent
    // PostgreSQL transactions below.
    await client.query("begin");
    await client.query("set local role service_role");
    try {
      const customer = other;
      const customerAssessmentScope = raceAssessmentScope;
      const issuedBuild = raceIssuedBuild;
      const paidJob = raceAssessmentJob;
      const foreignFinalStripeCustomerId =
        providerIds.assessmentStripeCustomer;
      const positiveAuthority = {
        async service(context, work) {
          await setActor(
            client,
            context.actorKind,
            {
              organizationId:
                context.organizationId ?? customer.organizationId,
              userId: context.userId ?? customer.userId
            },
            context.userId ?? customer.userId
          );
          return work(client);
        }
      };
      let positiveStartPurpose = null;
      const positiveStartSessionId =
        `cs_test_v46_positive_start_${randomUUID().replaceAll("-", "_")}`;
      const positiveStartPaymentIntentId =
        `pi_test_v46_positive_start_${randomUUID().replaceAll("-", "_")}`;
      const positiveStartEventId =
        `evt_test_v46_positive_start_${randomUUID().replaceAll("-", "_")}`;
      const positiveCustomerId = raceAssessmentStripeCustomerId;
      const positiveStartProvider = {
        async createCustomBuildStartCheckout(input) {
          positiveStartPurpose = structuredClone(input.purpose);
          assert.equal(input.purpose.price.amountMinor, 40000);
          assert.equal(input.purpose.quoteId, issuedBuild.quote.quoteId);
          return {
            checkoutId: positiveStartSessionId,
            url: "https://checkout.stripe.com/c/pay/v46_positive_start",
            expiresAt: isoAfter({ hours: 1 })
          };
        },
        async retrieveCustomBuildStartPayment(input) {
          assert.deepEqual(input.purpose, positiveStartPurpose);
          const facts = {
            schema:
              "sitesourcery.stripe-custom-build-start-payment-facts/v1",
            provider: "stripe",
            checkoutSessionId: positiveStartSessionId,
            paymentIntentId: positiveStartPaymentIntentId,
            customerId: positiveCustomerId,
            paymentStatus: "paid",
            subtotalMinor: 40000,
            taxMinor: 3200,
            totalMinor: 43200,
            taxMode: "automatic",
            currency: "USD",
            purposeDigest: input.purposeDigest,
            providerPaymentTime: isoAfter()
          };
          return Object.freeze({
            ...facts,
            providerFactsDigest: digest(facts)
          });
        },
        async retrieveCustomBuildStartCheckoutLifecycle(input) {
          return {
            schema:
              "sitesourcery.stripe-custom-build-start-checkout-lifecycle/v1",
            provider: "stripe",
            checkoutSessionId: input.checkoutSessionId,
            purposeDigest: input.purposeDigest,
            state: "expired"
          };
        }
      };
      const positiveStartPayment =
        createPostgresCustomServicesCustomBuildPayment({
          authority: positiveAuthority,
          provider: positiveStartProvider,
          release: {
            approved: true,
            currency: "USD",
            paymentWindowDays: 7,
            taxMode: "automatic"
          },
          clock: { now: () => new Date().toISOString() },
          ids: { next: () => randomUUID() }
        });
      const positiveStartInvoice =
        await positiveStartPayment.readCurrentInvoice(customerAssessmentScope);
      assert.equal(positiveStartInvoice.invoice.subtotal.amountMinor, 40000);
      assert.equal(positiveStartInvoice.invoice.finalHandoff.amountMinor, 60000);
      const positiveStartCheckout = await positiveStartPayment.createCheckout({
        ...customerAssessmentScope,
        commandId: `custom-build-v46-positive-${randomUUID()}`,
        invoiceId: positiveStartInvoice.invoice.invoiceId,
        invoiceDigest: positiveStartInvoice.invoice.invoiceDigest
      });
      assert.equal(positiveStartCheckout.state, "ready");
      const positiveStartPurposeDigest = digest(positiveStartPurpose);
      const positiveStartEvent = {
        id: positiveStartEventId,
        type: "checkout.session.completed",
        livemode: false,
        api_version: "2026-06-24.dahlia",
        created: Math.floor(Date.now() / 1000) - 1,
        data: {
          object: {
            id: positiveStartSessionId,
            metadata: {
              schema: "sitesourcery_custom_build_start_checkout_v1",
              tenant_id: positiveStartPurpose.tenantId,
              customer_id: positiveStartPurpose.customerId,
              project_id: positiveStartPurpose.projectId,
              quote_id: positiveStartPurpose.quoteId,
              quote_revision_id: positiveStartPurpose.quoteRevisionId,
              quote_acceptance_id: positiveStartPurpose.quoteAcceptanceId,
              credit_application_id:
                positiveStartPurpose.creditApplicationId,
              invoice_id: positiveStartPurpose.invoiceId,
              invoice_number: positiveStartPurpose.invoiceNumber,
              accepted_quote_digest:
                positiveStartPurpose.acceptedQuoteDigest,
              accepted_disclosure_digest:
                positiveStartPurpose.acceptedDisclosureDigest,
              invoice_digest: positiveStartPurpose.invoiceDigest,
              purpose_digest: positiveStartPurposeDigest
            }
          }
        }
      };
      const positiveStartSettlement =
        await positiveStartPayment.ingestStripeEvent(positiveStartEvent);
      assert.equal(positiveStartSettlement.status, "payment_settled");
      const positivePaid =
        await positiveStartPayment.readCurrentInvoice(customerAssessmentScope);
      const positiveJobId = positivePaid.job.jobId;
      assert.equal(positivePaid.job.finalHandoff.amountMinor, 60000);
      assert.equal(positivePaid.job.finalHandoff.state, "unpaid");

      const positiveProgress =
        createPostgresCustomServicesCustomBuildProgress({
          authority: positiveAuthority
        });
      const positiveChecking = await positiveProgress.recordProgress(
        operatorActor,
        positiveJobId,
        {
          commandId: `custom-build-v46-progress-${randomUUID()}`,
          customerSummary:
            "The exact Site scope is complete and ready for final payment proof.",
          expectedRevision: 0,
          milestones: {
            structure: "done",
            content: "done",
            responsive: "done",
            quality: "done"
          },
          nextStep:
            "Attach the final desktop and phone evidence for this Site build.",
          organizationId: customer.organizationId,
          stage: "checking"
        }
      );
      assert.equal(positiveChecking.progress.revision, 1);

      const positiveEvidenceCapturedAt = new Date(
        Date.parse(positiveChecking.progress.updatedAt) + 1
      ).toISOString();
      const positiveCompletion =
        createPostgresCustomServicesCustomBuildChangeCompletion({
          authority: positiveAuthority,
          // PostgreSQL retains microseconds while the projection intentionally
          // returns milliseconds. One millisecond after the projected boundary
          // remains deterministic and cannot fall before retained progress.
          clock: { now: () => positiveEvidenceCapturedAt }
        });
      const positiveEvidenceBoundary = await client.query(
        `select
           job.state as job_state,
           progress.stage as progress_stage,
           progress.recorded_at <= $2::timestamptz as captured_after_progress,
           $2::timestamptz <= clock_timestamp() as captured_not_future,
           not exists (
             select 1
             from ss.service_custom_build_completion_packages package
             where package.organization_id = job.organization_id
               and package.job_id = job.id
           ) as completion_absent
         from ss.service_custom_build_jobs job
         left join lateral (
           select candidate.stage, candidate.recorded_at
           from ss.service_custom_build_progress_updates candidate
           where candidate.organization_id = job.organization_id
             and candidate.job_id = job.id
           order by candidate.revision desc
           limit 1
         ) progress on true
         where job.organization_id = $1 and job.id = $3`,
        [
          customer.organizationId,
          positiveEvidenceCapturedAt,
          positiveJobId
        ]
      );
      assert.deepEqual(positiveEvidenceBoundary.rows, [{
        job_state: "open",
        progress_stage: "checking",
        captured_after_progress: true,
        captured_not_future: true,
        completion_absent: true
      }]);
      const positiveDesktop = await positiveCompletion.uploadEvidence(
        operatorActor,
        positiveJobId,
        {
          accessibleDescription:
            "Positive final-payment Site proof at the reviewed desktop width.",
          commandId: `custom-build-v46-evidence-${randomUUID()}`,
          dataBase64: completionPng(1440, 1000, 72).toString("base64"),
          mediaType: "image/png",
          organizationId: customer.organizationId,
          viewport: "desktop"
        }
      );
      const positivePhone = await positiveCompletion.uploadEvidence(
        operatorActor,
        positiveJobId,
        {
          accessibleDescription:
            "Positive final-payment Site proof at the reviewed phone width.",
          commandId: `custom-build-v46-evidence-${randomUUID()}`,
          dataBase64: completionPng(390, 844, 88).toString("base64"),
          mediaType: "image/png",
          organizationId: customer.organizationId,
          viewport: "phone"
        }
      );
      const positiveEvidenceIds = positivePhone.evidence
        .filter((entry) => entry.progressRevision === 1)
        .map((entry) => entry.evidenceId)
        .sort();
      assert.equal(positiveEvidenceIds.length, 2);
      assert.equal(positiveDesktop.evidence.length, 1);
      const positiveCompleted = await positiveCompletion.recordCompletion(
        operatorActor,
        positiveJobId,
        {
          checks: {
            accessibilityBasics: true,
            contactActions: true,
            desktop: true,
            links: true,
            phone: true,
            scope: true
          },
          commandId: `custom-build-v46-completion-${randomUUID()}`,
          customerSummary:
            "The exact Site scope passed all final desktop, phone, link, contact, and accessibility checks.",
          evidenceIds: positiveEvidenceIds,
          organizationId: customer.organizationId
        }
      );
      assert.equal(positiveCompleted.state, "ready_for_final_payment");

      const positiveFinal = await client.query(
        `select
           obligation.id as obligation_id,
           obligation.obligation_digest,
           obligation.completion_package_id,
           obligation.completion_package_digest,
           to_json(obligation.effective_change_order_digests)
             as effective_change_order_digests,
           obligation.accepted_quote_digest,
           obligation.accepted_disclosure_digest,
           obligation.final_due_minor,
           obligation.credit_minor,
           obligation.workmanship_correction_days,
           invoice.id as invoice_id,
           invoice.invoice_number,
           invoice.invoice_digest,
           invoice.subtotal_minor,
           invoice.credit_minor as invoice_credit_minor,
           line.component_key,
           line.amount_minor,
           line.credit_minor as line_credit_minor,
           line.quote_installment_id,
           (select count(*)::int
            from ss.service_custom_build_final_zero_balance_clearances clearance
            where clearance.job_id = obligation.job_id) as clearance_count
         from ss.service_custom_build_final_obligations obligation
         join ss.service_custom_build_final_invoices invoice
           on invoice.organization_id = obligation.organization_id
          and invoice.obligation_id = obligation.id
         join ss.service_custom_build_final_invoice_lines line
           on line.organization_id = invoice.organization_id
          and line.invoice_id = invoice.id
         where obligation.job_id = $1`,
        [positiveJobId]
      );
      assert.equal(positiveFinal.rowCount, 1);
      const positiveFinalRow = positiveFinal.rows[0];
      const customerBoundDigest = await client.query(
        `select
           obligation_digest,
           customer_user_id,
           $2::uuid as alternate_customer_user_id,
           ss.custom_build_final_obligation_digest(
             organization_id,
             project_id,
             customer_user_id,
             job_id,
             quote_id,
             quote_revision,
             quote_revision_id,
             quote_acceptance_id,
             completion_package_id,
             completion_package_digest,
             base_scope_digest,
             effective_change_order_digests,
             effective_scope_digest,
             accepted_quote_digest,
             accepted_disclosure_digest,
             commercial_contract_id,
             commercial_contract_digest,
             quote_installment_id,
             final_due_minor,
             currency,
             workmanship_correction_days,
             bound_at
           ) as exact_customer_digest,
           ss.custom_build_final_obligation_digest(
             organization_id,
             project_id,
             $2::uuid,
             job_id,
             quote_id,
             quote_revision,
             quote_revision_id,
             quote_acceptance_id,
             completion_package_id,
             completion_package_digest,
             base_scope_digest,
             effective_change_order_digests,
             effective_scope_digest,
             accepted_quote_digest,
             accepted_disclosure_digest,
             commercial_contract_id,
             commercial_contract_digest,
             quote_installment_id,
             final_due_minor,
             currency,
             workmanship_correction_days,
             bound_at
           ) as other_customer_digest
         from ss.service_custom_build_final_obligations
         where id = $1`,
        [positiveFinalRow.obligation_id, positiveDigestForeignCustomerId]
      );
      assert.equal(
        customerBoundDigest.rows[0].customer_user_id,
        customer.userId
      );
      assert.equal(
        customerBoundDigest.rows[0].alternate_customer_user_id,
        positiveDigestForeignCustomerId
      );
      assert.notEqual(
        customerBoundDigest.rows[0].alternate_customer_user_id,
        customerBoundDigest.rows[0].customer_user_id
      );
      assert.equal(
        customerBoundDigest.rows[0].exact_customer_digest,
        customerBoundDigest.rows[0].obligation_digest
      );
      assert.notEqual(
        customerBoundDigest.rows[0].other_customer_digest,
        customerBoundDigest.rows[0].exact_customer_digest,
        "changing only customerUserId must change the obligation digest"
      );
      assert.deepEqual(positiveFinalRow.effective_change_order_digests, []);
      assert.equal(Number(positiveFinalRow.final_due_minor), 60000);
      assert.equal(Number(positiveFinalRow.credit_minor), 0);
      assert.equal(positiveFinalRow.workmanship_correction_days, 30);
      assert.match(positiveFinalRow.invoice_number, /^SSCB-FINAL-/u);
      assert.equal(Number(positiveFinalRow.subtotal_minor), 60000);
      assert.equal(Number(positiveFinalRow.invoice_credit_minor), 0);
      assert.equal(
        positiveFinalRow.component_key,
        "custom_build_final_installment"
      );
      assert.equal(Number(positiveFinalRow.amount_minor), 60000);
      assert.equal(Number(positiveFinalRow.line_credit_minor), 0);
      assert.ok(positiveFinalRow.quote_installment_id);
      assert.equal(positiveFinalRow.clearance_count, 0);

      const finalPurpose = {
        schema: "sitesourcery.custom-build-final-checkout-purpose/v1",
        purpose: "custom_build_final",
        tenantId: customer.organizationId,
        customerId: customer.userId,
        projectId: customer.projectId,
        jobId: positiveJobId,
        finalObligationId: positiveFinalRow.obligation_id,
        finalObligationDigest: positiveFinalRow.obligation_digest,
        completionPackageId: positiveFinalRow.completion_package_id,
        completionPackageDigest:
          positiveFinalRow.completion_package_digest,
        effectiveChangeOrderDigests:
          positiveFinalRow.effective_change_order_digests,
        invoiceId: positiveFinalRow.invoice_id,
        invoiceNumber: positiveFinalRow.invoice_number,
        invoiceDigest: positiveFinalRow.invoice_digest,
        acceptedQuoteDigest: positiveFinalRow.accepted_quote_digest,
        acceptedDisclosureDigest:
          positiveFinalRow.accepted_disclosure_digest,
        price: { amountMinor: 60000, currency: "USD" },
        taxMode: "automatic"
      };
      assert.deepEqual(finalPurpose.effectiveChangeOrderDigests, []);
      const finalPurposeDigest = digest(finalPurpose);
      const finalAttemptId = randomUUID();
      const finalCreatedAt = new Date().toISOString();
      const finalExpiresAt = new Date(
        Date.parse(finalCreatedAt) + 3_600_000
      ).toISOString();
      const finalSessionId =
        `cs_test_v46_final_${randomUUID().replaceAll("-", "_")}`;
      const finalEventId =
        `evt_test_v46_final_${randomUUID().replaceAll("-", "_")}`;
      const finalPaymentIntentId =
        `pi_test_v46_final_${randomUUID().replaceAll("-", "_")}`;
      const finalChargeId =
        `ch_test_v46_final_${randomUUID().replaceAll("-", "_")}`;
      const positiveHandoffCommandId =
        `custom-build-v47-handoff-${randomUUID()}`;
      const positiveHandoffSummary =
        "The completed Site build, final review evidence, and customer delivery files are ready in one immutable handoff.";
      const positiveDeliveryManifest = {
        items: [
          {
            label: "Production website package",
            description:
              "The reviewed production website and its launch-ready files."
          },
          {
            label: "Final review notes",
            description:
              "Plain-language delivery, maintenance, and final review notes."
          }
        ]
      };
      const positiveHandoffSql =
        `select *
         from ss.create_service_custom_build_handoff(
           $1, $2, $3, $4, $5, $6, $7::jsonb
         )`;
      const positiveHandoffParameters = (
        deliveryManifest = positiveDeliveryManifest,
        commandId = positiveHandoffCommandId,
        customerSummary = positiveHandoffSummary
      ) => [
        positiveJobId,
        commandId,
        customer.organizationId,
        positiveFinalRow.completion_package_digest,
        positiveFinalRow.obligation_digest,
        customerSummary,
        JSON.stringify(deliveryManifest)
      ];
      const createPositiveHandoff = (
        deliveryManifest = positiveDeliveryManifest,
        commandId = positiveHandoffCommandId,
        customerSummary = positiveHandoffSummary
      ) => client.query(
        positiveHandoffSql,
        positiveHandoffParameters(
          deliveryManifest,
          commandId,
          customerSummary
        )
      );

      await setActor(client, "customer", customer);
      await client.query(
        `select pg_advisory_xact_lock(
           hashtextextended('ss-custom-build-h1m:' || $1::text, 0)
         )`,
        [positiveJobId]
      );
      await insertRow(client, "service_custom_build_final_checkout_attempts", {
        id: finalAttemptId,
        organization_id: customer.organizationId,
        project_id: customer.projectId,
        customer_user_id: customer.userId,
        job_id: positiveJobId,
        obligation_id: positiveFinalRow.obligation_id,
        completion_package_id: positiveFinalRow.completion_package_id,
        invoice_id: positiveFinalRow.invoice_id,
        command_id: `custom-build-v46-final-${randomUUID()}`,
        provider: "stripe",
        purpose: "custom_build_final",
        purpose_digest: finalPurposeDigest,
        obligation_digest: positiveFinalRow.obligation_digest,
        completion_package_digest:
          positiveFinalRow.completion_package_digest,
        invoice_digest: positiveFinalRow.invoice_digest,
        accepted_quote_digest: positiveFinalRow.accepted_quote_digest,
        accepted_disclosure_digest:
          positiveFinalRow.accepted_disclosure_digest,
        expected_subtotal_minor: 60000,
        currency: "USD",
        tax_mode: "automatic",
        provider_request_expires_at: finalExpiresAt,
        state: "provider_pending",
        provider_effect_certainty: "ambiguous",
        created_at: finalCreatedAt
      });
      await client.query(
        `update ss.service_custom_build_final_checkout_attempts
         set state = 'ready',
             provider_effect_certainty = 'confirmed',
             checkout_session_id = $2,
             checkout_url = $3,
             expires_at = provider_request_expires_at
         where id = $1`,
        [
          finalAttemptId,
          finalSessionId,
          "https://checkout.stripe.com/c/pay/v46_positive_final"
        ]
      );

      await setActor(client, "system", customer);
      await expectRejected(
        client,
        () => client.query(
          `update ss.service_custom_build_final_checkout_attempts
           set state = 'paid'
           where id = $1`,
          [finalAttemptId]
        ),
        /transition lacks authority/iu
      );
      const providerCreatedAt = new Date(
        Date.now() - 1000
      ).toISOString();
      const signatureVerifiedAt = new Date().toISOString();
      await insertRow(client, "service_custom_build_final_stripe_events", {
        id: finalEventId,
        organization_id: customer.organizationId,
        project_id: customer.projectId,
        customer_user_id: customer.userId,
        job_id: positiveJobId,
        obligation_id: positiveFinalRow.obligation_id,
        completion_package_id: positiveFinalRow.completion_package_id,
        invoice_id: positiveFinalRow.invoice_id,
        checkout_attempt_id: finalAttemptId,
        event_type: "checkout.session.completed",
        livemode: false,
        api_version: "2026-06-24.dahlia",
        checkout_session_id: finalSessionId,
        payload_digest: digest({ id: finalEventId, purpose: finalPurpose }),
        provider_created_at: providerCreatedAt,
        signature_verified_at: signatureVerifiedAt,
        state: "pending"
      });
      await setActor(client, "operator", customer, secondOperatorId);
      await expectRejected(
        client,
        createPositiveHandoff,
        /lacks exact completion and financial clearance/iu
      );
      await setActor(client, "system", customer);
      const finalProviderPaidAt = new Date().toISOString();
      const finalProviderFactsWithoutDigest = {
        schema: "sitesourcery.stripe-custom-build-final-payment-facts/v1",
        provider: "stripe",
        checkoutSessionId: finalSessionId,
        paymentIntentId: finalPaymentIntentId,
        chargeId: finalChargeId,
        customerId: positiveCustomerId,
        paymentStatus: "paid",
        chargeCaptured: true,
        amountRefundedMinor: 0,
        disputed: false,
        subtotalMinor: 60000,
        taxMinor: 4800,
        totalMinor: 64800,
        taxMode: "automatic",
        currency: "USD",
        purposeDigest: finalPurposeDigest,
        providerPaymentTime: finalProviderPaidAt
      };
      const finalProviderFactsDigest = digest(
        finalProviderFactsWithoutDigest
      );
      const finalProviderFacts = {
        ...finalProviderFactsWithoutDigest,
        providerFactsDigest: finalProviderFactsDigest
      };
      const finalReceipt = {
        id: randomUUID(),
        organization_id: customer.organizationId,
        project_id: customer.projectId,
        case_id: paidJob.caseId,
        customer_user_id: customer.userId,
        job_id: positiveJobId,
        obligation_id: positiveFinalRow.obligation_id,
        completion_package_id: positiveFinalRow.completion_package_id,
        invoice_id: positiveFinalRow.invoice_id,
        checkout_attempt_id: finalAttemptId,
        receipt_source: "stripe_event",
        stripe_event_id: finalEventId,
        provider: "stripe",
        checkout_session_id: finalSessionId,
        payment_intent_id: finalPaymentIntentId,
        charge_id: finalChargeId,
        stripe_customer_id: positiveCustomerId,
        payment_status: "paid",
        charge_captured: true,
        amount_refunded_minor: 0,
        disputed: false,
        subtotal_minor: 60000,
        tax_minor: 4800,
        total_minor: 64800,
        tax_mode: "automatic",
        currency: "USD",
        purpose: "custom_build_final",
        purpose_digest: finalPurposeDigest,
        obligation_digest: positiveFinalRow.obligation_digest,
        completion_package_digest:
          positiveFinalRow.completion_package_digest,
        invoice_digest: positiveFinalRow.invoice_digest,
        accepted_quote_digest: positiveFinalRow.accepted_quote_digest,
        accepted_disclosure_digest:
          positiveFinalRow.accepted_disclosure_digest,
        provider_facts: finalProviderFacts,
        provider_facts_digest: finalProviderFactsDigest,
        provider_paid_at: finalProviderPaidAt,
        settled_at: new Date().toISOString()
      };
      const foreignCustomerProviderFactsWithoutDigest = {
        ...finalProviderFactsWithoutDigest,
        customerId: foreignFinalStripeCustomerId
      };
      const foreignCustomerProviderFactsDigest = digest(
        foreignCustomerProviderFactsWithoutDigest
      );
      await expectRejected(
        client,
        () => insertRow(
          client,
          "service_custom_build_final_payment_receipts",
          {
            ...finalReceipt,
            id: randomUUID(),
            stripe_customer_id: foreignFinalStripeCustomerId,
            provider_facts: {
              ...foreignCustomerProviderFactsWithoutDigest,
              providerFactsDigest: foreignCustomerProviderFactsDigest
            },
            provider_facts_digest: foreignCustomerProviderFactsDigest
          }
        ),
        /service_custom_build_final_receipt_stripe_customer_org_fk/iu
      );

      await setActor(client, "operator", customer, secondOperatorId);
      const runningReconciliationId = randomUUID();
      const runningReconciliationCommandId =
        `custom-build-v47-final-reconcile-${randomUUID()}`;
      const runningRequestDigest = await client.query(
        `select ss.custom_build_final_reconciliation_request_digest(
           $1, $2, $3, $4, $5
         ) as digest`,
        [
          secondOperatorId,
          customer.organizationId,
          positiveJobId,
          finalAttemptId,
          runningReconciliationCommandId
        ]
      );
      await insertRow(
        client,
        "service_custom_build_final_reconciliation_commands",
        {
          id: runningReconciliationId,
          organization_id: customer.organizationId,
          job_id: positiveJobId,
          checkout_attempt_id: finalAttemptId,
          operator_user_id: secondOperatorId,
          command_id: runningReconciliationCommandId,
          request_digest: runningRequestDigest.rows[0].digest,
          state: "running"
        }
      );
      await expectRejected(
        client,
        createPositiveHandoff,
        /lacks exact completion and financial clearance/iu
      );

      const manifestAtLimit = deliveryManifestAtCanonicalByteCount(
        30 * 1024
      );
      const manifestOverLimit = deliveryManifestAtCanonicalByteCount(
        30 * 1024 + 1
      );
      const manifestBoundary = await client.query(
        `select
           ss.service_custom_build_handoff_manifest_is_valid(
             $1::jsonb
           ) as at_limit,
           ss.service_custom_build_handoff_manifest_is_valid(
             $2::jsonb
           ) as over_limit`,
        [JSON.stringify(manifestAtLimit), JSON.stringify(manifestOverLimit)]
      );
      assert.deepEqual(manifestBoundary.rows[0], {
        at_limit: true,
        over_limit: false
      });

      for (const [name, manifest] of [
        [
          "extra-top-level",
          {
            ...positiveDeliveryManifest,
            launchUrl: "https://customer.example.com/"
          }
        ],
        [
          "wrong-item-keys",
          {
            items: [{
              label: "Production website package",
              path: "delivery/site-production.zip"
            }]
          }
        ],
        [
          "extra-item-key",
          {
            items: [{
              ...positiveDeliveryManifest.items[0],
              type: "website_archive"
            }]
          }
        ],
        [
          "duplicate-portable-label",
          {
            items: [
              {
                label: "Production package",
                description: "The first customer delivery item."
              },
              {
                label: "production package",
                description: "The second customer delivery item."
              }
            ]
          }
        ],
        [
          "over-canonical-byte-limit",
          manifestOverLimit
        ],
        [
          "raw-provider-identifier",
          {
            items: [{
              label: "Receipt evt_test_customer_leak_123456",
              description: "The reviewed customer delivery item."
            }]
          }
        ],
        [
          "bearer-token",
          {
            items: [{
              label: "Production package",
              description:
                "Use Bearer abcdefghijklmnopqrstuvwxyz for delivery."
            }]
          }
        ]
      ]) {
        await expectRejected(
          client,
          () => createPositiveHandoff(
            manifest,
            `custom-build-v47-invalid-${name}-${randomUUID()}`
          ),
          /handoff input lacks bounded owner authority/iu
        );
      }
      for (const [name, summary] of [
        [
          "query-token",
          "Open the customer delivery with ?token=customer-secret-value."
        ],
        [
          "raw-provider",
          "The customer reference is cs_test_customer_leak_123456."
        ]
      ]) {
        await expectRejected(
          client,
          () => createPositiveHandoff(
            positiveDeliveryManifest,
            `custom-build-v47-invalid-summary-${name}-${randomUUID()}`,
            summary
          ),
          /handoff input lacks bounded owner authority/iu
        );
      }
      for (const commandId of [
        " handoff-padded-command ",
        "handoff-secret-command",
        "handoff-cs_test_customer_leak_123456"
      ]) {
        await expectRejected(
          client,
          () => createPositiveHandoff(
            positiveDeliveryManifest,
            commandId
          ),
          /handoff input lacks bounded owner authority/iu
        );
      }

      // Commit the pending final-payment evidence so independent sessions can
      // observe one exact job. A gate transaction queues handoff first and
      // settlement second on the shared H1M key. The settlement transaction
      // then stays open after its receipt write while the successful handoff
      // retry queues behind it. This proves both orderings without sleeps.
      await client.query("commit");
      const exactHandoffCapabilities = await client.query(
        `select
           ss.service_operator_has_capability(
             $1, 'service_job_manage', clock_timestamp()
           ) as job_manage,
           ss.service_operator_has_capability(
             $1, 'service_document_manage', clock_timestamp()
           ) as document_manage,
           ss.service_operator_has_capability(
             $1, 'service_payment_reconcile', clock_timestamp()
           ) as payment_reconcile`,
        [handoffOnlyOperatorId]
      );
      assert.deepEqual(exactHandoffCapabilities.rows, [{
        job_manage: true,
        document_manage: true,
        payment_reconcile: false
      }]);
      const handoffOnlyAuthority = {
        async service(context, work) {
          const transactionClient = await pool.connect();
          try {
            await transactionClient.query("begin");
            await transactionClient.query("set local role service_role");
            await setActor(
              transactionClient,
              context.actorKind,
              customer,
              context.userId
            );
            const result = await work(transactionClient);
            await transactionClient.query("commit");
            return result;
          } catch (error) {
            await transactionClient.query("rollback").catch(() => {});
            throw error;
          } finally {
            transactionClient.release();
          }
        }
      };
      const handoffOnlyBoundary =
        createPostgresCustomServicesCustomBuildHandoff({
          authority: handoffOnlyAuthority
        });
      const handoffOnlyReadiness = await handoffOnlyBoundary.readOwner(
        { userId: handoffOnlyOperatorId },
        positiveJobId,
        customer.organizationId
      );
      assert.equal(
        handoffOnlyReadiness.state,
        "payment_reconciliation_required"
      );
      assert.equal(
        handoffOnlyReadiness.action.handoffAvailable,
        false
      );
      assert.deepEqual(
        Object.keys(handoffOnlyReadiness).sort(),
        [
          "action",
          "completion",
          "finalObligation",
          "financialClearance",
          "handoff",
          "jobId",
          "organizationId",
          "projectId",
          "schema",
          "state"
        ]
      );
      const readinessKeys = [];
      const collectReadinessKeys = (value) => {
        if (!value || typeof value !== "object") return;
        for (const [key, selected] of Object.entries(value)) {
          readinessKeys.push(key);
          collectReadinessKeys(selected);
        }
      };
      collectReadinessKeys(handoffOnlyReadiness);
      assert.deepEqual(
        readinessKeys.filter((key) => [
          "attemptId",
          "attemptState",
          "checkoutSessionId",
          "eventId",
          "eventState",
          "paymentIntentId",
          "provider",
          "providerEffectCertainty",
          "providerErrorCode",
          "reconciliationCode",
          "receiptSource"
        ].includes(key)),
        [],
        "handoff readiness leaked payment lifecycle or provider fields"
      );
      const reconcileOnlyBoundary =
        createPostgresCustomServicesCustomBuildFinalPayment({
          authority: handoffOnlyAuthority,
          provider: {
            async createCustomBuildFinalCheckout() {
              throw new Error("capability denial must precede Checkout");
            },
            async retrieveCustomBuildFinalPayment() {
              throw new Error("capability denial must precede readback");
            },
            async retrieveCustomBuildFinalCheckoutLifecycle() {
              throw new Error("capability denial must precede lifecycle");
            }
          },
          release: {
            approved: false,
            currency: "USD",
            holdScope: "new_checkout_creation_only",
            providerEffectProcessing:
              "settlement_and_reconciliation_continue",
            taxMode: "automatic"
          }
        });
      await assert.rejects(
        reconcileOnlyBoundary.readOwnerFinalPayments(
          { userId: handoffOnlyOperatorId },
          positiveJobId,
          customer.organizationId
        ),
        (error) =>
          error.code === "CUSTOM_BUILD_FINAL_PAYMENT_UNAVAILABLE" &&
          error.status === 404
      );

      const pendingHandoffEntered = deferred();
      const settlementEntered = deferred();
      const settlementWritten = deferred();
      const releaseSettlement = deferred();
      const retryHandoffEntered = deferred();
      const runPositiveHandoff = async (entered) => {
        const transactionClient = new Client({
          connectionString: DATABASE_URL
        });
        try {
          await transactionClient.connect();
          await transactionClient.query("begin");
          await transactionClient.query("set local role service_role");
          await setActor(
            transactionClient,
            "operator",
            customer,
            handoffOnlyOperatorId
          );
          const backend = await transactionClient.query(
            "select pg_backend_pid()::int as pid"
          );
          entered.resolve(backend.rows[0].pid);
          const result = await transactionClient.query(
            positiveHandoffSql,
            positiveHandoffParameters()
          );
          await transactionClient.query("set constraints all immediate");
          await transactionClient.query("commit");
          return result;
        } catch (error) {
          entered.reject(error);
          await transactionClient.query("rollback").catch(() => {});
          throw error;
        } finally {
          await transactionClient.end().catch(() => {});
        }
      };
      const runFinalSettlement = async () => {
        const transactionClient = new Client({
          connectionString: DATABASE_URL
        });
        try {
          await transactionClient.connect();
          await transactionClient.query("begin");
          await transactionClient.query("set local role service_role");
          await setActor(transactionClient, "system", customer);
          const backend = await transactionClient.query(
            "select pg_backend_pid()::int as pid"
          );
          settlementEntered.resolve(backend.rows[0].pid);
          // The production receipt trigger discovers the immutable job and
          // acquires the shared H1M lock. Do not pre-lock it in test code: the
          // blocked PID below must prove the real settlement mutation waits.
          await insertRow(
            transactionClient,
            "service_custom_build_final_payment_receipts",
            finalReceipt
          );
          await setActor(
            transactionClient,
            "operator",
            customer,
            secondOperatorId
          );
          await transactionClient.query(
            `update ss.service_custom_build_final_reconciliation_commands
             set state = 'completed',
                 result = jsonb_build_object(
                   'schema',
                   'sitesourcery.custom-build-final-reconciliation/v1',
                   'status',
                   'payment_already_settled'
                 ),
                 result_digest = ss.service_json_digest(
                   jsonb_build_object(
                     'schema',
                     'sitesourcery.custom-build-final-reconciliation/v1',
                     'status',
                     'payment_already_settled'
                   )
                 ),
                 completed_at = clock_timestamp()
             where id = $1`,
            [runningReconciliationId]
          );
          await transactionClient.query("set constraints all immediate");
          settlementWritten.resolve();
          await releaseSettlement.promise;
          await transactionClient.query("commit");
          return finalReceipt.id;
        } catch (error) {
          settlementEntered.reject(error);
          settlementWritten.reject(error);
          await transactionClient.query("rollback").catch(() => {});
          throw error;
        } finally {
          await transactionClient.end().catch(() => {});
        }
      };

      let raceGateOpen = false;
      let positiveHandoff;
      let settlementPromise;
      let retryHandoffPromise;
      try {
        await client.query("begin");
        raceGateOpen = true;
        await client.query(
          `select pg_advisory_xact_lock(
             hashtextextended('ss-custom-build-h1m:' || $1::text, 0)
           )`,
          [positiveJobId]
        );
        const pendingHandoffPromise = runPositiveHandoff(
          pendingHandoffEntered
        );
        pendingHandoffPromise.catch(() => {});
        const pendingHandoffPid = await within(
          pendingHandoffEntered.promise,
          "pending handoff transaction did not start",
          15_000
        );
        assert.equal(
          await waitForDatabaseLock(client, pendingHandoffPid),
          true,
          "pending handoff did not queue on the shared H1M lock"
        );

        settlementPromise = runFinalSettlement();
        settlementPromise.catch(() => {});
        const settlementPid = await within(
          settlementEntered.promise,
          "final settlement transaction did not start",
          15_000
        );
        assert.equal(
          await waitForDatabaseLock(client, settlementPid),
          true,
          "final settlement did not queue behind pending handoff"
        );

        await client.query("commit");
        raceGateOpen = false;
        await assert.rejects(
          within(
            pendingHandoffPromise,
            "pending handoff did not reject before settlement",
            15_000
          ),
          /lacks exact completion and financial clearance/iu
        );
        await within(
          settlementWritten.promise,
          "final settlement did not write verified evidence",
          15_000
        );

        retryHandoffPromise = runPositiveHandoff(
          retryHandoffEntered
        );
        retryHandoffPromise.catch(() => {});
        const retryHandoffPid = await within(
          retryHandoffEntered.promise,
          "post-settlement handoff retry did not start",
          15_000
        );
        assert.equal(
          await waitForDatabaseLock(client, retryHandoffPid),
          true,
          "handoff retry did not queue behind the open settlement"
        );
        releaseSettlement.resolve();
        assert.equal(
          await within(
            settlementPromise,
            "final settlement did not commit",
            15_000
          ),
          finalReceipt.id
        );
        positiveHandoff = await within(
          retryHandoffPromise,
          "handoff retry did not commit after settlement",
          15_000
        );
      } finally {
        releaseSettlement.resolve();
        if (raceGateOpen) {
          await client.query("rollback").catch(() => {});
        }
        await settlementPromise?.catch(() => {});
        await retryHandoffPromise?.catch(() => {});
      }

      await client.query("begin");
      await client.query("set local role service_role");
      await setActor(client, "system", customer);
      const positiveSettlement = await client.query(
        `select
           attempt.state as attempt_state,
           event.state as event_state,
           receipt.charge_captured,
           receipt.amount_refunded_minor,
           receipt.disputed,
           (select count(*)::int
            from ss.service_custom_build_stripe_payment_claims claim
            where claim.organization_id = receipt.organization_id
              and claim.purpose = 'custom_build_final') as claim_count
         from ss.service_custom_build_final_payment_receipts receipt
         join ss.service_custom_build_final_checkout_attempts attempt
           on attempt.id = receipt.checkout_attempt_id
         join ss.service_custom_build_final_stripe_events event
           on event.id = receipt.stripe_event_id
         where receipt.job_id = $1`,
        [positiveJobId]
      );
      assert.deepEqual(positiveSettlement.rows[0], {
        attempt_state: "paid",
        event_state: "processed",
        charge_captured: true,
        amount_refunded_minor: "0",
        disputed: false,
        claim_count: 3
      });
      const reconciledCommand = await client.query(
        `select state
           from ss.service_custom_build_final_reconciliation_commands
          where id = $1`,
        [runningReconciliationId]
      );
      assert.deepEqual(reconciledCommand.rows, [{ state: "completed" }]);

      assert.equal(positiveHandoff.rowCount, 1);
      assert.match(
        positiveHandoff.rows[0].handoff_digest,
        /^[0-9a-f]{64}$/u
      );
      assert.equal(
        positiveHandoff.rows[0].workmanship_starts_at.toISOString(),
        positiveHandoff.rows[0].handed_off_at.toISOString()
      );
      assert.equal(
        positiveHandoff.rows[0].workmanship_ends_at.getTime() -
          positiveHandoff.rows[0].workmanship_starts_at.getTime(),
        30 * 24 * 60 * 60 * 1000
      );
      await client.query("set constraints all immediate");

      const positiveHandoffStored = await client.query(
        `select
           receipt.*,
           document.document_kind,
           document.object_key,
           document.visibility,
           document.retention_class,
           document.media_type,
           document.byte_count,
           payload.content_digest as payload_digest,
           payload.byte_count as payload_byte_count,
           payload.payload as payload_bytes,
           convert_from(payload.payload, 'UTF8')::jsonb as payload_json
         from ss.service_custom_build_handoff_receipts receipt
         join ss.service_documents document
           on document.organization_id = receipt.organization_id
          and document.id = receipt.document_id
         join ss.service_document_payloads payload
           on payload.organization_id = receipt.organization_id
          and payload.document_id = receipt.document_id
         where receipt.id = $1`,
        [positiveHandoff.rows[0].receipt_id]
      );
      assert.equal(positiveHandoffStored.rowCount, 1);
      const positiveHandoffRow = positiveHandoffStored.rows[0];
      const positiveRaceCounts = await client.query(
        `select
           (select count(*)::int
              from ss.service_custom_build_final_payment_receipts
             where job_id = $1) as payment_receipts,
           (select count(*)::int
              from ss.service_custom_build_handoff_receipts
             where job_id = $1) as handoff_receipts,
           (select count(*)::int
              from ss.service_documents document
             where document.organization_id = $2
               and document.project_id = $3
               and document.document_kind = 'handoff'
               and document.object_key like $4) as documents,
           (select count(*)::int
              from ss.service_document_payloads payload
              join ss.service_custom_build_handoff_receipts receipt
                on receipt.organization_id = payload.organization_id
               and receipt.document_id = payload.document_id
             where receipt.job_id = $1) as payloads`,
        [
          positiveJobId,
          customer.organizationId,
          customer.projectId,
          `%/custom-build-jobs/${positiveJobId}/handoff/%`
        ]
      );
      assert.deepEqual(positiveRaceCounts.rows, [{
        payment_receipts: 1,
        handoff_receipts: 1,
        documents: 1,
        payloads: 1
      }]);
      assert.equal(
        positiveHandoffRow.financial_clearance_kind,
        "provider_confirmed_final_payment"
      );
      assert.equal(
        positiveHandoffRow.final_payment_receipt_id,
        finalReceipt.id
      );
      assert.equal(positiveHandoffRow.zero_balance_clearance_id, null);
      assert.equal(positiveHandoffRow.final_invoice_id, positiveFinalRow.invoice_id);
      assert.equal(
        positiveHandoffRow.completion_package_digest,
        positiveFinalRow.completion_package_digest
      );
      assert.equal(
        positiveHandoffRow.final_obligation_digest,
        positiveFinalRow.obligation_digest
      );
      assert.equal(positiveHandoffRow.workmanship_interval_bounds, "[)");
      assert.equal(positiveHandoffRow.document_kind, "handoff");
      assert.equal(positiveHandoffRow.visibility, "customer");
      assert.equal(positiveHandoffRow.retention_class, "project");
      assert.equal(positiveHandoffRow.media_type, "application/json");
      assert.equal(
        Number(positiveHandoffRow.byte_count),
        Number(positiveHandoffRow.payload_byte_count)
      );
      assert.equal(
        positiveHandoffRow.document_content_digest,
        positiveHandoffRow.payload_digest
      );
      assert.equal(
        positiveHandoffRow.object_key,
        `service-documents/${customer.organizationId}/` +
          `${customer.projectId}/custom-build-jobs/${positiveJobId}/` +
          `handoff/${positiveHandoff.rows[0].document_id}.json`
      );
      assert.deepEqual(
        positiveHandoffRow.payload_json.deliveryManifest,
        positiveDeliveryManifest.items
      );
      assert.equal(
        positiveHandoffRow.payload_json.financialClearance.kind,
        "provider_confirmed_final_payment"
      );
      assert.equal(
        positiveHandoffRow.payload_json.handoff.workmanship.coverage,
        "[start,end)"
      );
      assert.doesNotMatch(
        JSON.stringify(positiveHandoffRow.payload_json),
        /(?:cs|pi|ch|cus|evt)_test_/u
      );
      const durableHandoffReader =
        createPostgresCustomServicesCustomBuildHandoff({
          authority: {
            async service(context, work) {
              await setActor(
                client,
                context.actorKind,
                customer,
                context.userId
              );
              return work(client);
            }
          }
        });
      const durableDocument =
        await durableHandoffReader.readCustomerDocument(
          {
            actorId: customer.userId,
            customerId: customer.userId,
            organizationId: customer.organizationId,
            projectId: customer.projectId
          },
          positiveHandoff.rows[0].document_id
        );
      const durableCustomerBytes = Buffer.from(
        canonicalJson(durableDocument.payload),
        "utf8"
      );
      assert.equal(
        durableDocument.byteCount,
        durableCustomerBytes.byteLength
      );
      assert.equal(
        durableDocument.contentDigest,
        digest(durableCustomerBytes)
      );
      assert.equal(
        durableDocument.byteCount,
        Number(positiveHandoffRow.document_byte_count)
      );
      assert.equal(
        durableDocument.contentDigest,
        positiveHandoffRow.document_content_digest
      );
      assert.deepEqual(
        durableDocument.payload,
        positiveHandoffRow.payload_json
      );
      assert.deepEqual(
        durableCustomerBytes,
        Buffer.from(positiveHandoffRow.payload_bytes),
        "hosted handoff reader must return the exact stored canonical bytes"
      );
      const retainedHandoffState =
        await durableHandoffReader.readCustomer({
          actorId: customer.userId,
          customerId: customer.userId,
          organizationId: customer.organizationId,
          projectId: customer.projectId
        });
      const paidFinalState = await reconcileOnlyBoundary.readCurrentState({
        actorId: customer.userId,
        customerId: customer.userId,
        organizationId: customer.organizationId,
        projectId: customer.projectId
      });
      assert.equal(paidFinalState.state, "paid_handoff_pending");
      assert.equal(retainedHandoffState.state, "handed_off");
      const browserFinalState = {
        ...structuredClone(paidFinalState),
        state: "handed_off",
        handoff: {
          state: "handed_off",
          documentId: retainedHandoffState.handoff.documentId,
          contentDigest: retainedHandoffState.handoff.contentDigest,
          handedOffAt: retainedHandoffState.handoff.handedOffAt,
          workmanshipStartsAt:
            retainedHandoffState.handoff.workmanship.startsAt,
          workmanshipEndsAt:
            retainedHandoffState.handoff.workmanship.endsAt
        },
        action: {
          checkoutAvailable: false,
          handoffAvailable: false,
          reason: "handed_off"
        }
      };
      const abracadabraRequests = [];
      const abracadabraClient = createAbracadabraClient({
        baseUrl: "/api/v1",
        fetch: async (url, options) => {
          abracadabraRequests.push({ url, options });
          return {
            ok: true,
            status: 200,
            headers: {
              get(name) {
                if (name.toLowerCase() === "content-type") {
                  return "application/json";
                }
                if (name.toLowerCase() === "x-request-id") {
                  return "req_v47_exact_handoff_document";
                }
                return null;
              }
            },
            async json() {
              return structuredClone(durableDocument);
            },
            async text() {
              return JSON.stringify(durableDocument);
            }
          };
        }
      });
      const browserValidatedDocument =
        await abracadabraClient.getCustomServicesCustomBuildHandoffDocument(
          customer.projectId,
          durableDocument.documentId,
          { expectedState: browserFinalState }
        );
      assert.equal(abracadabraRequests.length, 1);
      assert.deepEqual(browserValidatedDocument, durableDocument);
      const browserValidatedBytes = Buffer.from(
        canonicalJson(browserValidatedDocument.payload),
        "utf8"
      );
      assert.deepEqual(
        browserValidatedBytes,
        Buffer.from(positiveHandoffRow.payload_bytes),
        "Abracadabra validation must not transform the post-hash payload"
      );
      assert.equal(
        browserValidatedDocument.byteCount,
        browserValidatedBytes.byteLength
      );
      assert.equal(
        browserValidatedDocument.contentDigest,
        digest(browserValidatedBytes)
      );
      for (const timestamp of [
        browserValidatedDocument.payload.financialClearance.clearedAt,
        browserValidatedDocument.payload.handoff.handedOffAt,
        browserValidatedDocument.payload.handoff.workmanship.startsAt,
        browserValidatedDocument.payload.handoff.workmanship.endsAt
      ]) {
        assert.match(
          timestamp,
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u
        );
        assert.equal(new Date(timestamp).toISOString(), timestamp);
      }
      await setActor(
        client,
        "operator",
        customer,
        handoffOnlyOperatorId
      );
      assert.deepEqual(
        (await createPositiveHandoff()).rows,
        positiveHandoff.rows
      );
      await expectRejected(
        client,
        () => client.query(
          `select *
           from ss.create_service_custom_build_handoff(
             $1, $2, $3, $4, $5, $6, $7::jsonb
           )`,
          [
            positiveJobId,
            positiveHandoffCommandId,
            customer.organizationId,
            positiveFinalRow.completion_package_digest,
            positiveFinalRow.obligation_digest,
            `${positiveHandoffSummary} Conflicting replay.`,
            JSON.stringify(positiveDeliveryManifest)
          ]
        ),
        /command digest conflicts/iu
      );
      await setActor(client, "operator", customer, secondOperatorId);
      await expectRejected(
        client,
        createPositiveHandoff,
        /already has an immutable handoff/iu
      );
      const retainedHandoffReceiptCount = await client.query(
        `select count(*)::int as count
         from ss.service_custom_build_handoff_receipts receipt
         where receipt.organization_id = $1
           and receipt.job_id = $2`,
        [customer.organizationId, positiveJobId]
      );
      assert.equal(
        retainedHandoffReceiptCount.rows[0].count,
        1,
        "changed-command and other-operator conflicts retain exactly one handoff receipt"
      );
      await expectRejected(
        client,
        () => client.query(
          `update ss.service_documents
           set content_digest = $2
           where id = $1`,
          [positiveHandoff.rows[0].document_id, "f".repeat(64)]
        ),
        /(?:immutable|permission denied)/iu
      );
      await expectRejected(
        client,
        () => client.query(
          `update ss.service_document_payloads
           set payload = convert_to('{"corrupt":true}', 'UTF8')
           where document_id = $1`,
          [positiveHandoff.rows[0].document_id]
        ),
        /(?:immutable|permission denied)/iu
      );
      await expectRejected(
        client,
        () => insertRow(
          client,
          "service_custom_build_final_checkout_attempts",
          {
            id: randomUUID(),
            organization_id: customer.organizationId,
            project_id: customer.projectId,
            customer_user_id: customer.userId,
            job_id: positiveJobId,
            obligation_id: positiveFinalRow.obligation_id,
            completion_package_id: positiveFinalRow.completion_package_id,
            invoice_id: positiveFinalRow.invoice_id,
            command_id: `custom-build-v47-closed-${randomUUID()}`,
            provider: "stripe",
            purpose: "custom_build_final",
            purpose_digest: finalPurposeDigest,
            obligation_digest: positiveFinalRow.obligation_digest,
            completion_package_digest:
              positiveFinalRow.completion_package_digest,
            invoice_digest: positiveFinalRow.invoice_digest,
            accepted_quote_digest: positiveFinalRow.accepted_quote_digest,
            accepted_disclosure_digest:
              positiveFinalRow.accepted_disclosure_digest,
            expected_subtotal_minor: 60000,
            currency: "USD",
            tax_mode: "automatic",
            provider_request_expires_at: isoAfter({ hours: 1 }),
            state: "provider_pending",
            provider_effect_certainty: "ambiguous"
          }
        ),
        /closed by immutable handoff/iu
      );
    } finally {
      await client.query("rollback");
    }

    const voidedBuild = await customBuild.voidQuote(
      operatorActor,
      issuedBuild.quote.quoteId,
      {
        commandId: `custom-build-void-${randomUUID()}`,
        organizationId: customer.organizationId,
        reason:
          "Customer requested a corrected scope before any payment setup began."
      }
    );
    assert.equal(voidedBuild.state, "voided");
    assert.equal(voidedBuild.credit.state, "released");
    const replayAfterVoid = await customBuild.acceptCurrentQuote({
      ...customerAssessmentScope,
      acceptanceStatement: "accepted_exact_custom_build_quote",
      acceptedDisclosureDigest: customerBuildIssued.quote.disclosureDigest,
      acceptedQuoteDigest: customerBuildIssued.quote.quoteDigest,
      commandId: customBuildAcceptanceCommandId,
      quoteId: customerBuildIssued.quote.quoteId,
      quoteRevision: customerBuildIssued.quote.quoteRevision
    });
    assert.equal(replayAfterVoid.state, "voided");
    assert.equal(replayAfterVoid.credit.state, "released");
    assert.equal(
      (await assessmentWork.readCustomerReport(
        customerAssessmentScope
      )).credit.state,
      "available"
    );

    const replacementBuild = await customBuild.issueQuote(
      operatorActor,
      paidJob.jobId,
      {
        ...customBuildIssue,
        commandId: `custom-build-issue-${randomUUID()}`,
        tierId: "card-plus",
        craftedPages: 1,
        sections: 8,
        uniqueLayouts: 1,
        contentWords: 900,
        suppliedMedia: 8,
        scopeStatement:
          "Build one polished Card Plus page with the corrected essential design scope."
      }
    );
    assert.equal(replacementBuild.quote.pricing.serviceAmountMinor, 65000);
    assert.equal(replacementBuild.quote.pricing.startDueMinor, 45000);
    assert.equal(replacementBuild.quote.pricing.finalDueMinor, 0);
    assert.equal(replacementBuild.credit.state, "available");

    const replacementCustomerQuote = await customBuild.readCurrentQuote(
      customerAssessmentScope
    );
    const replacementAccepted = await customBuild.acceptCurrentQuote({
      ...customerAssessmentScope,
      acceptanceStatement: "accepted_exact_custom_build_quote",
      acceptedDisclosureDigest:
        replacementCustomerQuote.quote.disclosureDigest,
      acceptedQuoteDigest: replacementCustomerQuote.quote.quoteDigest,
      commandId: `custom-build-accept-${randomUUID()}`,
      quoteId: replacementCustomerQuote.quote.quoteId,
      quoteRevision: replacementCustomerQuote.quote.quoteRevision
    });
    assert.equal(replacementAccepted.state, "accepted");
    assert.equal(replacementAccepted.credit.state, "reserved");

    let retainedBuildPurpose = null;
    const buildCheckoutId = providerIds.buildStartCheckout;
    const buildCustomerId = providerIds.assessmentStripeCustomer;
    const buildPaymentIntentId = providerIds.buildStartPaymentIntent;
    const customBuildPaymentProvider = {
      async createCustomBuildStartCheckout(input) {
        retainedBuildPurpose = structuredClone(input.purpose);
        assert.equal(input.purpose.price.amountMinor, 45000);
        assert.equal(input.purpose.quoteId, replacementBuild.quote.quoteId);
        return {
          checkoutId: buildCheckoutId,
          url: "https://checkout.stripe.com/c/pay/custom_build_start_1",
          expiresAt: isoAfter({ hours: 1 })
        };
      },
      async retrieveCustomBuildStartPayment(input) {
        assert.deepEqual(input.purpose, retainedBuildPurpose);
        const facts = {
          schema:
            "sitesourcery.stripe-custom-build-start-payment-facts/v1",
          provider: "stripe",
          checkoutSessionId: buildCheckoutId,
          paymentIntentId: buildPaymentIntentId,
          customerId: buildCustomerId,
          paymentStatus: "paid",
          subtotalMinor: 45000,
          taxMinor: 3600,
          totalMinor: 48600,
          taxMode: "automatic",
          currency: "USD",
          purposeDigest: input.purposeDigest,
          providerPaymentTime: isoAfter()
        };
        return Object.freeze({
          ...facts,
          providerFactsDigest: digest(facts)
        });
      },
      async retrieveCustomBuildStartCheckoutLifecycle(input) {
        return {
          schema:
            "sitesourcery.stripe-custom-build-start-checkout-lifecycle/v1",
          provider: "stripe",
          checkoutSessionId: input.checkoutSessionId,
          purposeDigest: input.purposeDigest,
          state: "expired"
        };
      }
    };
    const customBuildPayment =
      createPostgresCustomServicesCustomBuildPayment({
        authority: customBuildAuthority,
        provider: customBuildPaymentProvider,
        release: {
          approved: true,
          currency: "USD",
          paymentWindowDays: 7,
          taxMode: "automatic"
        },
        clock: { now: () => new Date().toISOString() },
        ids: { next: () => randomUUID() }
      });
    const customBuildWork =
      createPostgresCustomServicesCustomBuildWork({
        authority: customBuildAuthority
      });
    assert.deepEqual(await customBuildPayment.readiness(), {
      schema: "sitesourcery.custom-build-payment-readiness/v1",
      ready: true,
      state: "approved",
      runtimeContract: "canonical-ss-v42-custom-build-start-payment",
      automaticTax: true,
      stripeReadback: true,
      atomicCreditSettlement: true,
      opensBuildJob: true
    });
    const buildInvoice = await customBuildPayment.readCurrentInvoice(
      customerAssessmentScope
    );
    assert.equal(buildInvoice.state, "checkout_available");
    assert.equal(buildInvoice.invoice.subtotal.amountMinor, 45000);
    assert.equal(buildInvoice.invoice.credit.amountMinor, 20000);
    assert.equal(buildInvoice.invoice.finalHandoff.amountMinor, 0);
    assert.equal(buildInvoice.invoice.lines.length, 2);
    assert.equal(
      buildInvoice.invoice.lines.reduce(
        (total, line) => total + line.amountMinor,
        0
      ),
      45000
    );
    const buildCheckoutInput = {
      ...customerAssessmentScope,
      commandId: `custom-build-checkout-${randomUUID()}`,
      invoiceId: buildInvoice.invoice.invoiceId,
      invoiceDigest: buildInvoice.invoice.invoiceDigest
    };
    const buildCheckout = await customBuildPayment.createCheckout(
      buildCheckoutInput
    );
    assert.equal(buildCheckout.state, "ready");
    assert.equal(buildCheckout.checkout.subtotal.amountMinor, 45000);
    assert.deepEqual(
      await customBuildPayment.createCheckout(buildCheckoutInput),
      buildCheckout
    );
    assert.ok(retainedBuildPurpose);
    const buildPurposeDigest = digest(retainedBuildPurpose);
    const buildMetadata = {
      schema: "sitesourcery_custom_build_start_checkout_v1",
      tenant_id: retainedBuildPurpose.tenantId,
      customer_id: retainedBuildPurpose.customerId,
      project_id: retainedBuildPurpose.projectId,
      quote_id: retainedBuildPurpose.quoteId,
      quote_revision_id: retainedBuildPurpose.quoteRevisionId,
      quote_acceptance_id: retainedBuildPurpose.quoteAcceptanceId,
      credit_application_id: retainedBuildPurpose.creditApplicationId,
      invoice_id: retainedBuildPurpose.invoiceId,
      invoice_number: retainedBuildPurpose.invoiceNumber,
      accepted_quote_digest: retainedBuildPurpose.acceptedQuoteDigest,
      accepted_disclosure_digest:
        retainedBuildPurpose.acceptedDisclosureDigest,
      invoice_digest: retainedBuildPurpose.invoiceDigest,
      purpose_digest: buildPurposeDigest
    };
    const buildStripeEvent = {
      id: providerIds.buildStartEvent,
      type: "checkout.session.completed",
      livemode: false,
      api_version: "2026-06-24.dahlia",
      created: Math.floor(Date.now() / 1000) - 1,
      data: {
        object: {
          id: buildCheckoutId,
          metadata: buildMetadata
        }
      }
    };
    const buildSettlement = await customBuildPayment.ingestStripeEvent(
      buildStripeEvent
    );
    assert.equal(buildSettlement.status, "payment_settled");
    assert.equal(buildSettlement.next, "custom_build_work");
    assert.deepEqual(
      await customBuildPayment.ingestStripeEvent(buildStripeEvent),
      buildSettlement
    );
    const paidBuildInvoice = await customBuildPayment.readCurrentInvoice(
      customerAssessmentScope
    );
    assert.equal(paidBuildInvoice.state, "paid");
    assert.equal(paidBuildInvoice.invoice.credit.state, "settled");
    assert.equal(paidBuildInvoice.job.state, "open");
    assert.equal(paidBuildInvoice.job.tierId, "card-plus");
    assert.equal(
      paidBuildInvoice.job.targetCompletionDate,
      customBuildIssue.targetCompletionDate
    );
    assert.equal(paidBuildInvoice.job.firstPayment.creditMinor, 20000);
    assert.equal(
      paidBuildInvoice.job.firstPayment.paidSubtotalMinor,
      45000
    );
    assert.equal(paidBuildInvoice.job.finalHandoff.state, "not_required");
    assert.equal(paidBuildInvoice.job.finalHandoff.amountMinor, 0);
    assert.equal(
      Object.hasOwn(paidBuildInvoice.job, "paymentIntentId"),
      false
    );
    const ownerBuildJobs = await customBuildWork.listJobs(operatorActor);
    const ownerBuildJob = ownerBuildJobs.jobs.find(
      (entry) => entry.job.jobId === paidBuildInvoice.job.jobId
    );
    assert.ok(ownerBuildJob);
    assert.deepEqual(ownerBuildJob.job, paidBuildInvoice.job);
    assert.equal(ownerBuildJob.customer.customerId, customer.userId);

    const customBuildProgress =
      createPostgresCustomServicesCustomBuildProgress({
        authority: customBuildAuthority
      });
    assert.deepEqual(await customBuildProgress.readiness(), {
      schema: "sitesourcery.custom-build-progress-readiness/v1",
      ready: true,
      state: "ready",
      runtimeContract: "canonical-ss-v43-custom-build-progress"
    });
    const buildJobId = paidBuildInvoice.job.jobId;
    const defaultProgress = await customBuildProgress.readOwnerProgress(
      operatorActor,
      buildJobId,
      customer.organizationId
    );
    assert.equal(defaultProgress.status.kind, "preparing");
    assert.equal(defaultProgress.progress.revision, 0);
    assert.equal(defaultProgress.activeRequest, null);
    assert.deepEqual(
      await customBuildProgress.readCustomerProgress(customerAssessmentScope),
      defaultProgress
    );

    const progressCommand = {
      commandId: `custom-build-progress-${randomUUID()}`,
      customerSummary:
        "The approved structure is ready and the first pages are being built.",
      expectedRevision: 0,
      milestones: {
        structure: "done",
        content: "in_progress",
        responsive: "pending",
        quality: "pending"
      },
      nextStep:
        "Apply the approved content and check the first phone layout.",
      organizationId: customer.organizationId,
      stage: "building"
    };
    const buildingProgress = await customBuildProgress.recordProgress(
      operatorActor,
      buildJobId,
      progressCommand
    );
    assert.equal(buildingProgress.status.kind, "building");
    assert.equal(buildingProgress.progress.revision, 1);
    assert.equal(buildingProgress.progress.milestones[0].state, "done");
    assert.deepEqual(
      await customBuildProgress.recordProgress(
        operatorActor,
        buildJobId,
        progressCommand
      ),
      buildingProgress
    );
    await assert.rejects(
      customBuildProgress.recordProgress(operatorActor, buildJobId, {
        ...progressCommand,
        commandId: `custom-build-progress-${randomUUID()}`
      }),
      (error) =>
        error.code === "CUSTOM_BUILD_PROGRESS_CHANGED" &&
        error.status === 409
    );
    await assert.rejects(
      customBuildProgress.recordProgress(operatorActor, buildJobId, {
        ...progressCommand,
        commandId: `custom-build-progress-${randomUUID()}`,
        expectedRevision: 1,
        milestones: {
          ...progressCommand.milestones,
          structure: "pending"
        },
        stage: "preparing"
      }),
      (error) =>
        error.code === "CUSTOM_BUILD_PROGRESS_CHANGED" &&
        error.status === 409
    );

    const decisionRequestCommand = {
      access: null,
      commandId: `custom-build-request-${randomUUID()}`,
      customerMessage:
        "Please choose which approved About-page paragraph should be used.",
      expectedProgressRevision: 1,
      organizationId: customer.organizationId,
      requestKind: "customer_decision",
      safeInstructions:
        "Reply with either the first or second approved paragraph.",
      targetDateImpact: "under_review",
      title: "Choose the About-page paragraph"
    };
    const decisionRequest = await customBuildProgress.openRequest(
      operatorActor,
      buildJobId,
      decisionRequestCommand
    );
    assert.equal(decisionRequest.status.kind, "action_needed");
    assert.equal(decisionRequest.activeRequest.state, "open");
    assert.equal(decisionRequest.activeRequest.revision, 1);
    assert.deepEqual(
      await customBuildProgress.openRequest(
        operatorActor,
        buildJobId,
        decisionRequestCommand
      ),
      decisionRequest
    );
    await assert.rejects(
      customBuildProgress.openRequest(operatorActor, buildJobId, {
        ...decisionRequestCommand,
        commandId: `custom-build-request-${randomUUID()}`,
        title: "A second request must not open"
      }),
      (error) =>
        error.code === "CUSTOM_BUILD_PROGRESS_CHANGED" &&
        error.status === 409
    );

    const decisionResponseCommand = {
      commandId: `custom-build-response-${randomUUID()}`,
      expectedRevision: 1,
      responseKind: "provided",
      responseNote: "Use the second approved paragraph."
    };
    await assert.rejects(
      customBuildProgress.respondToRequest(
        { ...customerAssessmentScope, projectId: other.projectId },
        decisionRequest.activeRequest.requestId,
        decisionResponseCommand
      ),
      (error) =>
        error.code === "CUSTOM_BUILD_PROGRESS_CHANGED" &&
        error.status === 409
    );
    await assert.rejects(
      customBuildProgress.respondToRequest(
        customerAssessmentScope,
        decisionRequest.activeRequest.requestId,
        {
          ...decisionResponseCommand,
          commandId: `custom-build-response-${randomUUID()}`,
          responseNote: "My access token is included here."
        }
      ),
      (error) => error.code === "INVALID_CUSTOM_BUILD_PROGRESS_INPUT"
    );
    const answeredDecision = await customBuildProgress.respondToRequest(
      customerAssessmentScope,
      decisionRequest.activeRequest.requestId,
      decisionResponseCommand
    );
    assert.equal(answeredDecision.status.kind, "reviewing_response");
    assert.equal(answeredDecision.activeRequest.state, "answered");
    assert.equal(answeredDecision.activeRequest.revision, 2);
    assert.deepEqual(
      await customBuildProgress.respondToRequest(
        customerAssessmentScope,
        decisionRequest.activeRequest.requestId,
        decisionResponseCommand
      ),
      answeredDecision
    );
    await assert.rejects(
      customBuildProgress.respondToRequest(
        customerAssessmentScope,
        decisionRequest.activeRequest.requestId,
        {
          ...decisionResponseCommand,
          commandId: `custom-build-response-${randomUUID()}`
        }
      ),
      (error) =>
        error.code === "CUSTOM_BUILD_PROGRESS_CHANGED" &&
        error.status === 409
    );

    const decisionResolutionCommand = {
      commandId: `custom-build-resolution-${randomUUID()}`,
      expectedRevision: 2,
      organizationId: customer.organizationId,
      resolutionNote:
        "The customer selected the second approved paragraph.",
      state: "resolved"
    };
    const resolvedDecision = await customBuildProgress.resolveRequest(
      operatorActor,
      buildJobId,
      decisionRequest.activeRequest.requestId,
      decisionResolutionCommand
    );
    assert.equal(resolvedDecision.status.kind, "building");
    assert.equal(resolvedDecision.activeRequest, null);
    assert.deepEqual(
      await customBuildProgress.resolveRequest(
        operatorActor,
        buildJobId,
        decisionRequest.activeRequest.requestId,
        decisionResolutionCommand
      ),
      resolvedDecision
    );

    const accessExpiresAt = isoAfter({ days: 7 });
    const accessRequest = await customBuildProgress.openRequest(
      operatorActor,
      buildJobId,
      {
        access: {
          accountLabel: "Avery Studio domain account",
          delegatedRole: "DNS manager",
          expiresAt: accessExpiresAt,
          providerLabel: "Spaceship"
        },
        commandId: `custom-build-request-${randomUUID()}`,
        customerMessage:
          "Please authorize bounded DNS management for this project.",
        expectedProgressRevision: 1,
        organizationId: customer.organizationId,
        requestKind: "delegated_access",
        safeInstructions:
          "Use the provider delegation screen and share no private sign-in information.",
        targetDateImpact: "under_review",
        title: "Authorize bounded DNS management"
      }
    );
    assert.equal(accessRequest.status.kind, "action_needed");
    assert.deepEqual(accessRequest.activeRequest.access, {
      providerLabel: "Spaceship",
      accountLabel: "Avery Studio domain account",
      delegatedRole: "DNS manager",
      expiresAt: accessExpiresAt
    });
    const storedAccess = await pool.query(
      `select provider_label, account_label, delegated_role,
              reason_code, state, job_id, expires_at
       from ss.service_access_requests
       where organization_id = $1 and job_id = $2`,
      [customer.organizationId, buildJobId]
    );
    assert.equal(storedAccess.rowCount, 1);
    assert.deepEqual({
      providerLabel: storedAccess.rows[0].provider_label,
      accountLabel: storedAccess.rows[0].account_label,
      delegatedRole: storedAccess.rows[0].delegated_role,
      reasonCode: storedAccess.rows[0].reason_code,
      state: storedAccess.rows[0].state,
      jobId: storedAccess.rows[0].job_id,
      expiresAt: new Date(storedAccess.rows[0].expires_at).toISOString()
    }, {
      providerLabel: "Spaceship",
      accountLabel: "Avery Studio domain account",
      delegatedRole: "DNS manager",
      reasonCode: "custom_build_execution",
      state: "sent",
      jobId: buildJobId,
      expiresAt: accessExpiresAt
    });
    const declinedAccess = await customBuildProgress.respondToRequest(
      customerAssessmentScope,
      accessRequest.activeRequest.requestId,
      {
        commandId: `custom-build-response-${randomUUID()}`,
        expectedRevision: 1,
        responseKind: "cannot_provide",
        responseNote:
          "I cannot authorize delegated access yet; please continue without it."
      }
    );
    assert.equal(declinedAccess.status.kind, "reviewing_response");
    const withdrawnAccess = await customBuildProgress.resolveRequest(
      operatorActor,
      buildJobId,
      accessRequest.activeRequest.requestId,
      {
        commandId: `custom-build-resolution-${randomUUID()}`,
        expectedRevision: 2,
        organizationId: customer.organizationId,
        resolutionNote:
          "Delegated access was not granted; the request is closed without verification.",
        state: "withdrawn"
      }
    );
    assert.equal(withdrawnAccess.activeRequest, null);
    assert.equal(withdrawnAccess.status.kind, "building");

    const customBuildChangeCompletion =
      createPostgresCustomServicesCustomBuildChangeCompletion({
        authority: customBuildAuthority
      });
    assert.deepEqual(await customBuildChangeCompletion.readiness(), {
      schema: "sitesourcery.custom-build-change-completion-readiness/v1",
      ready: true,
      state: "ready",
      runtimeContract:
        "canonical-ss-v44-custom-build-change-completion"
    });
    const initialChangeCompletion =
      await customBuildChangeCompletion.readOwner(
        operatorActor,
        buildJobId,
        customer.organizationId
      );
    assert.equal(initialChangeCompletion.state, "building");
    assert.deepEqual(initialChangeCompletion.changeOrders, []);
    assert.deepEqual(initialChangeCompletion.evidence, []);
    assert.equal(initialChangeCompletion.completion, null);

    const changeIssue = {
      addedScope:
        "Add the approved event announcement block and its responsive presentation.",
      commandId: `custom-build-change-${randomUUID()}`,
      expiresAt: isoAfter({ days: 7 }),
      organizationId: customer.organizationId,
      targetCompletionDate: dateAfter(50),
      unitCount: 2
    };
    const issuedChange = await customBuildChangeCompletion.issueChangeOrder(
      operatorActor,
      buildJobId,
      changeIssue
    );
    assert.deepEqual(
      await customBuildChangeCompletion.issueChangeOrder(
        operatorActor,
        buildJobId,
        changeIssue
      ),
      issuedChange
    );
    assert.equal(issuedChange.state, "change_order_review");
    assert.equal(issuedChange.changeOrders.length, 1);
    const firstChange = issuedChange.changeOrders[0];
    assert.equal(firstChange.state, "issued");
    assert.deepEqual(firstChange.pricing, {
      unitCount: 2,
      unitAmountMinor: 12500,
      subtotalMinor: 25000,
      currency: "USD",
      taxState: "automatic_tax_pending",
      paymentRequirement: "due_before_changed_work"
    });
    const customerChange = await customBuildChangeCompletion.readCustomer(
      customerAssessmentScope
    );
    assert.equal(customerChange.state, "change_order_review");
    assert.equal(
      customerChange.changeOrders.active.changeOrderId,
      firstChange.changeOrderId
    );
    const customerChangeJson = JSON.stringify(customerChange);
    for (const privateField of [
      "jobId",
      "createdByOperatorUserId",
      "documentId",
      "objectKey",
      "requestDigest"
    ]) {
      assert.equal(customerChangeJson.includes(privateField), false);
    }

    const changeAcceptance = {
      acceptanceStatement:
        "accepted_exact_change_order_and_payment_requirement",
      acceptedDisclosureDigest: firstChange.disclosureDigest,
      acceptedQuoteDigest: firstChange.quoteDigest,
      commandId: `custom-build-change-accept-${randomUUID()}`
    };
    const acceptedChange =
      await customBuildChangeCompletion.acceptChangeOrder(
        customerAssessmentScope,
        firstChange.changeOrderId,
        changeAcceptance
      );
    assert.equal(acceptedChange.state, "change_order_payment_required");
    assert.equal(
      acceptedChange.changeOrders.active.state,
      "accepted_payment_required"
    );
    assert.deepEqual(
      await customBuildChangeCompletion.acceptChangeOrder(
        customerAssessmentScope,
        firstChange.changeOrderId,
        changeAcceptance
      ),
      acceptedChange
    );

    const changeVoid = {
      commandId: `custom-build-change-void-${randomUUID()}`,
      expectedQuoteDigest: firstChange.quoteDigest,
      organizationId: customer.organizationId,
      reason:
        "Customer and owner agreed to remove this unpaid added-work request."
    };
    await assert.rejects(
      customBuildChangeCompletion.voidChangeOrder(
        operatorActor,
        buildJobId,
        firstChange.changeOrderId,
        { ...changeVoid, expectedQuoteDigest: "0".repeat(64) }
      ),
      (error) =>
        error.code === "CUSTOM_BUILD_CHANGE_COMPLETION_CHANGED" &&
        error.status === 409
    );
    const voidedChange = await customBuildChangeCompletion.voidChangeOrder(
      operatorActor,
      buildJobId,
      firstChange.changeOrderId,
      changeVoid
    );
    assert.equal(voidedChange.state, "building");
    assert.equal(voidedChange.changeOrders[0].state, "voided");
    assert.deepEqual(
      await customBuildChangeCompletion.voidChangeOrder(
        operatorActor,
        buildJobId,
        firstChange.changeOrderId,
        changeVoid
      ),
      voidedChange
    );

    const declinedIssue =
      await customBuildChangeCompletion.issueChangeOrder(
        operatorActor,
        buildJobId,
        {
          ...changeIssue,
          addedScope:
            "Add the optional approved footer announcement treatment to this build.",
          commandId: `custom-build-change-${randomUUID()}`,
          unitCount: 1
        }
      );
    const secondChange = declinedIssue.changeOrders[1];
    const declinedChange =
      await customBuildChangeCompletion.declineChangeOrder(
        customerAssessmentScope,
        secondChange.changeOrderId,
        {
          commandId: `custom-build-change-decline-${randomUUID()}`,
          declineStatement: "declined_exact_custom_build_change_quote",
          declinedDisclosureDigest: secondChange.disclosureDigest,
          declinedQuoteDigest: secondChange.quoteDigest
        }
      );
    assert.equal(declinedChange.state, "building");
    assert.equal(
      declinedChange.changeOrders.history.at(-1).state,
      "declined"
    );

    const expiresAt = new Date(Date.now() + 15_000).toISOString();
    const expiringChange = await customBuildChangeCompletion.issueChangeOrder(
      operatorActor,
      buildJobId,
      {
        ...changeIssue,
        addedScope:
          "Add the optional approved launch-note treatment if accepted before its short deadline.",
        commandId: `custom-build-change-${randomUUID()}`,
        expiresAt,
        unitCount: 1
      }
    );
    const thirdChange = expiringChange.changeOrders.at(-1);
    assert.equal(thirdChange.state, "issued");
    const expirationWaitMilliseconds = Math.max(
      0,
      Date.parse(expiresAt) - Date.now() + 250
    );
    await new Promise((resolve) =>
      setTimeout(resolve, expirationWaitMilliseconds)
    );
    const expirationCommand = {
      commandId: `custom-build-change-expiration-${randomUUID()}`,
      expectedQuoteDigest: thirdChange.quoteDigest,
      organizationId: customer.organizationId
    };
    const expiredChange = await customBuildChangeCompletion.expireChangeOrder(
      operatorActor,
      buildJobId,
      thirdChange.changeOrderId,
      expirationCommand
    );
    assert.equal(expiredChange.state, "building");
    assert.equal(expiredChange.changeOrders.at(-1).state, "expired");
    assert.ok(expiredChange.changeOrders.at(-1).expiredAt >= expiresAt);
    assert.deepEqual(
      await customBuildChangeCompletion.expireChangeOrder(
        operatorActor,
        buildJobId,
        thirdChange.changeOrderId,
        expirationCommand
      ),
      expiredChange
    );

    const payableChangeProjection =
      await customBuildChangeCompletion.issueChangeOrder(
        operatorActor,
        buildJobId,
        {
          ...changeIssue,
          addedScope:
            "Add the approved event announcement block and its responsive presentation after payment.",
          commandId: `custom-build-change-${randomUUID()}`,
          targetCompletionDate: dateAfter(55),
          unitCount: 2
        }
      );
    const payableChange = payableChangeProjection.changeOrders.at(-1);
    assert.equal(payableChange.state, "issued");
    assert.equal(payableChange.changeNumber, 4);
    const payableAcceptance =
      await customBuildChangeCompletion.acceptChangeOrder(
        customerAssessmentScope,
        payableChange.changeOrderId,
        {
          acceptanceStatement:
            "accepted_exact_change_order_and_payment_requirement",
          acceptedDisclosureDigest: payableChange.disclosureDigest,
          acceptedQuoteDigest: payableChange.quoteDigest,
          commandId: `custom-build-change-accept-${randomUUID()}`
        }
      );
    assert.equal(payableAcceptance.state, "change_order_payment_required");
    assert.equal(
      payableAcceptance.changeOrders.active.changeOrderId,
      payableChange.changeOrderId
    );

    let retainedChangePurpose = null;
    const changeCheckoutId = providerIds.buildChangeCheckout;
    const changePaymentIntentId = providerIds.buildChangePaymentIntent;
    const initialChangeCreateEntered = deferred();
    const releaseInitialChangeCreate = deferred();
    const initialChangeProviderRequests = [];
    let changePaymentMismatch = true;
    let changePaymentReadbacks = 0;
    let changeLifecycleReadbacks = 0;
    const customBuildChangePaymentProvider = {
      async createCustomBuildChangeCheckout(input) {
        initialChangeProviderRequests.push(structuredClone(input));
        retainedChangePurpose = structuredClone(input.purpose);
        assert.equal(input.stripeCustomerId, buildCustomerId);
        assert.equal(input.purpose.changeOrderId, payableChange.changeOrderId);
        assert.equal(input.purpose.changeNumber, 4);
        assert.deepEqual(input.purpose.price, {
          amountMinor: 25000,
          unitAmountMinor: 12500,
          quantity: 2,
          currency: "USD",
          billing: "one_time",
          taxBehavior: "automatic_exclusive"
        });
        assert.match(
          input.checkoutExpiresAt,
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u
        );
        initialChangeCreateEntered.resolve(structuredClone(input));
        await releaseInitialChangeCreate.promise;
        return {
          checkoutId: changeCheckoutId,
          url: "https://checkout.stripe.com/c/pay/custom_build_change_1",
          expiresAt: input.checkoutExpiresAt
        };
      },
      async retrieveCustomBuildChangePayment(input) {
        changePaymentReadbacks += 1;
        assert.deepEqual(input.purpose, retainedChangePurpose);
        const subtotalMinor = changePaymentMismatch ? 12500 : 25000;
        const taxMinor = changePaymentMismatch ? 1000 : 2000;
        const facts = {
          schema:
            "sitesourcery.stripe-custom-build-change-payment-facts/v1",
          provider: "stripe",
          checkoutSessionId: changeCheckoutId,
          paymentIntentId: changePaymentIntentId,
          customerId: buildCustomerId,
          paymentStatus: "paid",
          subtotalMinor,
          taxMinor,
          totalMinor: subtotalMinor + taxMinor,
          taxMode: "automatic",
          currency: "USD",
          purposeDigest: input.purposeDigest,
          providerPaymentTime: new Date(Date.now() - 500).toISOString()
        };
        return Object.freeze({
          ...facts,
          providerFactsDigest: digest(facts)
        });
      },
      async retrieveCustomBuildChangeCheckoutLifecycle(input) {
        changeLifecycleReadbacks += 1;
        return {
          schema:
            "sitesourcery.stripe-custom-build-change-checkout-lifecycle/v1",
          provider: "stripe",
          checkoutSessionId: input.checkoutSessionId,
          purposeDigest: input.purposeDigest,
          state: "paid"
        };
      }
    };
    const customBuildChangePayment =
      createPostgresCustomServicesCustomBuildChangePayment({
        authority: customBuildAuthority,
        provider: customBuildChangePaymentProvider,
        release: {
          approved: true,
          currency: "USD",
          holdScope: "new_checkout_creation_only",
          providerEffectProcessing:
            "settlement_and_reconciliation_continue",
          taxMode: "automatic"
        },
        clock: { now: () => new Date().toISOString() },
        ids: { next: () => randomUUID() }
      });
    assert.deepEqual(await customBuildChangePayment.readiness(), {
      schema: "sitesourcery.custom-build-change-payment-readiness/v1",
      ready: true,
      state: "approved",
      runtimeContract: "canonical-ss-v45-custom-build-change-payment",
      automaticTax: true,
      webhookWakeup: true,
      stripeReadback: true,
      atomicSettlement: true,
      activatesAcceptedChange: true,
      ownerReconciliation: true,
      holdScope: "new_checkout_creation_only",
      providerEffectProcessing: "settlement_and_reconciliation_continue"
    });
    const changeInvoice =
      await customBuildChangePayment.readCurrentInvoice(
        customerAssessmentScope
      );
    assert.equal(changeInvoice.state, "checkout_available");
    assert.equal(
      changeInvoice.invoice.changeOrderId,
      payableChange.changeOrderId
    );
    assert.equal(changeInvoice.invoice.changeNumber, 4);
    assert.equal(changeInvoice.invoice.subtotal.amountMinor, 25000);
    assert.deepEqual(
      changeInvoice.invoice.lines.map((line) => ({
        componentKey: line.componentKey,
        quantity: line.quantity,
        unitAmountMinor: line.unitAmountMinor,
        amountMinor: line.amountMinor
      })),
      [{
        componentKey: "custom_build_change_units",
        quantity: 2,
        unitAmountMinor: 12500,
        amountMinor: 25000
      }]
    );
    const changeCheckoutInput = {
      ...customerAssessmentScope,
      commandId: `custom-build-change-checkout-${randomUUID()}`,
      invoiceId: changeInvoice.invoice.invoiceId,
      invoiceDigest: changeInvoice.invoice.invoiceDigest
    };
    const initialStageLockEntered = deferred();
    const initialFinishLockEntered = deferred();
    let initialPaymentLockOrdinal = 0;
    const initialPaymentCapture = beginCustomBuildCapture((entry) => {
      if (!/select pg_advisory_xact_lock/u.test(entry.sql)) return;
      initialPaymentLockOrdinal += 1;
      if (initialPaymentLockOrdinal === 1) {
        initialStageLockEntered.resolve(entry);
      } else if (initialPaymentLockOrdinal === 2) {
        initialFinishLockEntered.resolve(entry);
      }
    });
    let initialPaymentLockHeld = false;
    let changeCheckout;
    try {
      await client.query("begin");
      await client.query(
        `select pg_advisory_xact_lock(
           hashtextextended('ss-custom-build-h1m:' || $1::text, 0)
         )`,
        [buildJobId]
      );
      initialPaymentLockHeld = true;
      const checkoutPromise = customBuildChangePayment.createCheckout(
        changeCheckoutInput
      );
      checkoutPromise.catch(() => {});
      const stageWait = await within(
        initialStageLockEntered.promise,
        "H1N stage did not reach the shared H1M lock"
      );
      assert.equal(
        await waitForDatabaseLock(client, stageWait.backendPid),
        true,
        "H1N stage did not wait before idempotency or attempt mutation"
      );
      const absentWhileStageWaited = await client.query(
        `select count(*)::int as count
         from ss.service_custom_build_change_checkout_attempts
         where organization_id = $1 and invoice_id = $2`,
        [customer.organizationId, changeInvoice.invoice.invoiceId]
      );
      assert.equal(absentWhileStageWaited.rows[0].count, 0);
      await client.query("commit");
      initialPaymentLockHeld = false;

      const initialProviderRequest = await within(
        initialChangeCreateEntered.promise,
        "H1N provider creation was not reached after stage release"
      );
      assert.equal(
        initialProviderRequest.idempotencyKey,
        changeCheckoutInput.commandId
      );

      const providerPendingInvoice =
        await customBuildChangePayment.readCurrentInvoice(
          customerAssessmentScope
        );
      assert.equal(providerPendingInvoice.state, "reconciliation_required");
      assert.deepEqual(providerPendingInvoice.action, {
        available: false,
        reason: "reconciliation_required"
      });
      const providerPendingOwner =
        await customBuildChangePayment.readOwnerPayments(
          operatorActor,
          buildJobId,
          customer.organizationId
        );
      const providerPendingPayment = providerPendingOwner.payments.find(
        (payment) => payment.invoice.invoiceId === changeInvoice.invoice.invoiceId
      );
      assert.equal(providerPendingPayment.state, "reconciliation_required");
      assert.equal(providerPendingPayment.owner.attemptState, "provider_pending");
      assert.equal(providerPendingPayment.owner.canReconcileCreation, true);
      assert.equal(providerPendingPayment.owner.canReconcileSettlement, false);

      await client.query("begin");
      await client.query(
        `select pg_advisory_xact_lock(
           hashtextextended('ss-custom-build-h1m:' || $1::text, 0)
         )`,
        [buildJobId]
      );
      initialPaymentLockHeld = true;
      releaseInitialChangeCreate.resolve();
      const finishWait = await within(
        initialFinishLockEntered.promise,
        "H1N finish did not reach the shared H1M lock"
      );
      assert.equal(
        await waitForDatabaseLock(client, finishWait.backendPid),
        true,
        "H1N finish did not wait before attempt or command mutation"
      );
      const pendingWhileFinishWaited = await client.query(
        `select state
         from ss.service_custom_build_change_checkout_attempts
         where organization_id = $1 and invoice_id = $2`,
        [customer.organizationId, changeInvoice.invoice.invoiceId]
      );
      assert.equal(pendingWhileFinishWaited.rows[0].state, "provider_pending");
      await client.query("commit");
      initialPaymentLockHeld = false;
      changeCheckout = await within(
        checkoutPromise,
        "H1N Checkout did not finish after the shared lock released"
      );
    } finally {
      if (initialPaymentLockHeld) {
        await client.query("rollback").catch(() => {});
      }
      initialPaymentCapture.stop();
    }
    assertLiveJobLockOrder(initialPaymentCapture.entries, {
      discovery:
        /from ss\.service_custom_build_change_invoices where organization_id = \$1/u,
      jobId: buildJobId,
      label: "stageCheckout",
      mutation: /insert into ss\.idempotency_keys/u
    });
    assertLiveJobLockOrder(initialPaymentCapture.entries, {
      discovery:
        /from ss\.service_custom_build_change_checkout_attempts where organization_id = \$1 and id = \$2/u,
      jobId: buildJobId,
      label: "finishCheckout",
      mutation:
        /update ss\.service_custom_build_change_checkout_attempts set state = 'ready'/u
    });
    assert.equal(changeCheckout.state, "ready");
    assert.equal(changeCheckout.checkout.chargeOccurred, false);
    assert.equal(changeCheckout.checkout.subtotal.amountMinor, 25000);
    assert.deepEqual(
      await customBuildChangePayment.createCheckout(changeCheckoutInput),
      changeCheckout
    );
    assert.equal(initialChangeProviderRequests.length, 1);
    assert.ok(retainedChangePurpose);
    assert.match(
      retainedChangePurpose.scopeBoundaryDigest,
      /^[0-9a-f]{64}$/u
    );
    assert.equal(
      retainedChangePurpose.acceptedQuoteDigest,
      payableChange.quoteDigest
    );
    assert.equal(
      retainedChangePurpose.acceptedDisclosureDigest,
      payableChange.disclosureDigest
    );
    const ownerChangePayments =
      await customBuildChangePayment.readOwnerPayments(
        operatorActor,
        buildJobId,
        customer.organizationId
      );
    const ownerPayableChange = ownerChangePayments.payments.find(
      (payment) =>
        payment.invoice.changeOrderId === payableChange.changeOrderId
    );
    assert.ok(ownerPayableChange);
    assert.equal(ownerPayableChange.state, "checkout_ready");
    assert.equal(ownerPayableChange.owner.attemptState, "ready");
    await assert.rejects(
      customBuildChangeCompletion.voidChangeOrder(
        operatorActor,
        buildJobId,
        payableChange.changeOrderId,
        {
          commandId: `custom-build-change-void-${randomUUID()}`,
          expectedQuoteDigest: payableChange.quoteDigest,
          organizationId: customer.organizationId,
          reason:
            "This paid-path change must not be voidable after provider payment evidence begins."
        }
      ),
      (error) =>
        error.code === "CUSTOM_BUILD_CHANGE_COMPLETION_CHANGED" &&
        error.status === 409
    );

    const completionProgress = await customBuildProgress.recordProgress(
      operatorActor,
      buildJobId,
      {
        commandId: `custom-build-progress-${randomUUID()}`,
        customerSummary:
          "The agreed Card Plus build is ready for final desktop and phone proof.",
        expectedRevision: 1,
        milestones: {
          structure: "done",
          content: "done",
          responsive: "done",
          quality: "done"
        },
        nextStep:
          "Attach final desktop and phone evidence before preparing handoff.",
        organizationId: customer.organizationId,
        stage: "checking"
      }
    );
    assert.equal(completionProgress.progress.revision, 2);
    assert.equal(completionProgress.status.kind, "checking");

    const initialDesktopBytes = completionPng(1440, 1000, 16);
    const initialPhoneBytes = completionPng(390, 844, 32);
    const desktopCompletion =
      await customBuildChangeCompletion.uploadEvidence(
        operatorActor,
        buildJobId,
        {
          accessibleDescription:
            "Final desktop view showing the complete approved Card Plus page.",
          commandId: `custom-build-completion-evidence-${randomUUID()}`,
          dataBase64: initialDesktopBytes.toString("base64"),
          mediaType: "image/png",
          organizationId: customer.organizationId,
          viewport: "desktop"
        }
      );
    assert.equal(desktopCompletion.evidence.length, 1);
    const phoneCompletion =
      await customBuildChangeCompletion.uploadEvidence(
        operatorActor,
        buildJobId,
        {
          accessibleDescription:
            "Final phone view showing the complete approved Card Plus page.",
          commandId: `custom-build-completion-evidence-${randomUUID()}`,
          dataBase64: initialPhoneBytes.toString("base64"),
          mediaType: "image/png",
          organizationId: customer.organizationId,
          viewport: "phone"
        }
      );
    assert.equal(phoneCompletion.evidence.length, 2);
    assert.deepEqual(
      phoneCompletion.evidence.map((entry) => [
        entry.viewport,
        entry.imageWidth,
        entry.imageHeight,
        entry.progressRevision
      ]),
      [
        ["desktop", 1440, 1000, 2],
        ["phone", 390, 844, 2]
      ]
    );
    const staleEvidenceIds = phoneCompletion.evidence
      .map((entry) => entry.evidenceId)
      .sort();
    const completionChecks = {
      accessibilityBasics: true,
      contactActions: true,
      desktop: true,
      links: true,
      phone: true,
      scope: true
    };
    await assert.rejects(
      customBuildChangeCompletion.recordCompletion(
        operatorActor,
        buildJobId,
        {
          checks: completionChecks,
          commandId: `custom-build-completion-${randomUUID()}`,
          customerSummary:
            "This proof cannot complete while an accepted change still requires verified payment.",
          evidenceIds: staleEvidenceIds,
          organizationId: customer.organizationId
        }
      ),
      (error) =>
        error.code === "CUSTOM_BUILD_CHANGE_COMPLETION_CHANGED" &&
        error.status === 409
    );

    const changePurposeDigest = digest(retainedChangePurpose);
    const changeMetadata = {
      schema: "sitesourcery_custom_build_change_checkout_v1",
      tenant_id: retainedChangePurpose.tenantId,
      customer_id: retainedChangePurpose.customerId,
      project_id: retainedChangePurpose.projectId,
      job_id: retainedChangePurpose.jobId,
      change_order_id: retainedChangePurpose.changeOrderId,
      change_acceptance_id: retainedChangePurpose.changeAcceptanceId,
      change_number: String(retainedChangePurpose.changeNumber),
      invoice_id: retainedChangePurpose.invoiceId,
      invoice_number: retainedChangePurpose.invoiceNumber,
      scope_boundary_digest: retainedChangePurpose.scopeBoundaryDigest,
      prior_effective_scope_digest:
        retainedChangePurpose.priorEffectiveScopeDigest,
      target_completion_date: retainedChangePurpose.targetCompletionDate,
      accepted_quote_digest: retainedChangePurpose.acceptedQuoteDigest,
      accepted_disclosure_digest:
        retainedChangePurpose.acceptedDisclosureDigest,
      invoice_digest: retainedChangePurpose.invoiceDigest,
      purpose_digest: changePurposeDigest
    };
    const changeStripeEvent = {
      id: providerIds.buildChangeEvent,
      type: "checkout.session.completed",
      livemode: false,
      api_version: "2026-06-24.dahlia",
      created: Math.floor(Date.now() / 1000) - 1,
      data: {
        object: {
          id: changeCheckoutId,
          metadata: changeMetadata
        }
      }
    };
    const eventRecoveryCapture = beginCustomBuildCapture();
    let changeReconciliation;
    try {
      changeReconciliation =
        await customBuildChangePayment.ingestStripeEvent(changeStripeEvent);
    } finally {
      eventRecoveryCapture.stop();
    }
    assert.deepEqual(changeReconciliation, {
      schema: "sitesourcery.custom-build-change-reconciliation/v1",
      status: "reconciliation_required",
      projectId: customer.projectId,
      changeOrderId: payableChange.changeOrderId,
      invoiceId: changeInvoice.invoice.invoiceId,
      next: "owner_review"
    });
    assertLiveJobLockOrder(eventRecoveryCapture.entries, {
      discovery:
        /from ss\.service_custom_build_change_checkout_attempts where organization_id = \$1 and checkout_session_id = \$2/u,
      jobId: buildJobId,
      label: "claimEvent",
      mutation:
        /insert into ss\.service_custom_build_change_stripe_events/u
    });
    assertLiveJobLockOrder(eventRecoveryCapture.entries, {
      discovery:
        /from ss\.service_custom_build_change_stripe_events where organization_id = \$1 and id = \$2/u,
      jobId: buildJobId,
      label: "markReconciliation",
      mutation:
        /update ss\.service_custom_build_change_stripe_events set state = 'reconciliation_required'/u
    });
    const mismatchedOwnerProjection =
      await customBuildChangePayment.readOwnerPayments(
        operatorActor,
        buildJobId,
        customer.organizationId
      );
    const mismatchedOwnerPayment = mismatchedOwnerProjection.payments.find(
      (payment) => payment.invoice.invoiceId === changeInvoice.invoice.invoiceId
    );
    assert.equal(mismatchedOwnerPayment.state, "reconciliation_required");
    assert.equal(mismatchedOwnerPayment.owner.canReconcileCreation, false);
    assert.equal(mismatchedOwnerPayment.owner.canReconcileSettlement, true);
    assert.equal(mismatchedOwnerPayment.owner.eventState, "reconciliation_required");

    const driftProviderPaidAt = new Date(Date.now() - 1_000).toISOString();
    const driftedProviderFactsWithoutDigest = {
      schema: "sitesourcery.stripe-custom-build-change-payment-facts/v1",
      provider: "stripe",
      checkoutSessionId: changeCheckoutId,
      paymentIntentId: changePaymentIntentId,
      customerId: buildCustomerId,
      paymentStatus: "paid",
      subtotalMinor: 25000,
      taxMinor: 1999,
      totalMinor: 26999,
      taxMode: "automatic",
      currency: "USD",
      purposeDigest: changePurposeDigest,
      providerPaymentTime: driftProviderPaidAt
    };
    const driftedProviderFacts = {
      ...driftedProviderFactsWithoutDigest,
      providerFactsDigest: digest(driftedProviderFactsWithoutDigest)
    };
    await client.query("begin");
    try {
      await client.query("set local role service_role");
      await setActor(
        client,
        "system",
        {
          organizationId: customer.organizationId,
          userId: customer.userId
        },
        customer.userId
      );
      await client.query(
        `select pg_advisory_xact_lock(
           hashtextextended('ss-custom-build-h1m:' || $1::text, 0)
         )`,
        [buildJobId]
      );
      await expectRejected(
        client,
        () => client.query(
          `insert into ss.service_custom_build_change_payment_receipts (
             id, organization_id, project_id, case_id,
             customer_user_id, job_id, change_order_id,
             change_acceptance_id, invoice_id, checkout_attempt_id,
             receipt_source, stripe_event_id,
             reconciled_by_operator_user_id, provider,
             checkout_session_id, payment_intent_id,
             stripe_customer_id, payment_status, subtotal_minor,
             tax_minor, total_minor, tax_mode, currency,
             purpose_digest, invoice_digest, accepted_quote_digest,
             accepted_disclosure_digest, provider_facts,
             provider_facts_digest, provider_paid_at, settled_at
           )
           select
             $1, invoice.organization_id, invoice.project_id,
             invoice.case_id, invoice.customer_user_id, invoice.job_id,
             invoice.change_order_id, invoice.change_acceptance_id,
             invoice.id, attempt.id, 'stripe_event', event.id, null,
             'stripe', attempt.checkout_session_id, $3, $4, 'paid',
             invoice.subtotal_minor, 2000,
             invoice.subtotal_minor + 2000, 'automatic', 'USD',
             attempt.purpose_digest, invoice.invoice_digest,
             invoice.accepted_quote_digest,
             invoice.accepted_disclosure_digest, $5::jsonb, $6, $7, $8
           from ss.service_custom_build_change_invoices invoice
           join ss.service_custom_build_change_checkout_attempts attempt
             on attempt.organization_id = invoice.organization_id
            and attempt.invoice_id = invoice.id
           join ss.service_custom_build_change_stripe_events event
             on event.organization_id = invoice.organization_id
            and event.checkout_attempt_id = attempt.id
           where invoice.id = $2`,
          [
            randomUUID(),
            changeInvoice.invoice.invoiceId,
            changePaymentIntentId,
            buildCustomerId,
            JSON.stringify(driftedProviderFacts),
            driftedProviderFacts.providerFactsDigest,
            driftProviderPaidAt,
            new Date().toISOString()
          ]
        ),
        /provider facts are internally inconsistent/iu
      );
    } finally {
      await client.query("rollback").catch(() => {});
    }

    changePaymentMismatch = false;
    const settlementReconciliationCommandId =
      `custom-build-change-reconcile-${randomUUID()}`;
    const settlementReconciliationInput = {
      attemptId: ownerPayableChange.owner.attemptId,
      organizationId: customer.organizationId,
      commandId: settlementReconciliationCommandId
    };
    const ownerSettlementCapture = beginCustomBuildCapture();
    let ownerSettlement;
    try {
      ownerSettlement =
        await customBuildChangePayment.reconcileCheckoutCreation(
          operatorActor,
          buildJobId,
          settlementReconciliationInput
        );
    } finally {
      ownerSettlementCapture.stop();
    }
    assert.deepEqual(Object.keys(ownerSettlement).sort(), [
      "action",
      "attemptId",
      "changeOrderId",
      "checkout",
      "invoiceId",
      "jobId",
      "next",
      "organizationId",
      "reason",
      "schema",
      "settlement",
      "status"
    ]);
    assert.equal(
      ownerSettlement.schema,
      "sitesourcery.custom-build-change-payment-reconciliation-command/v1"
    );
    assert.equal(ownerSettlement.status, "payment_settled");
    assert.equal(ownerSettlement.action, "settlement_reconciled");
    assert.equal(ownerSettlement.next, "custom_build_changed_work");
    assert.equal(ownerSettlement.reason, null);
    assert.equal(ownerSettlement.checkout, null);
    assert.equal(
      ownerSettlement.attemptId,
      ownerPayableChange.owner.attemptId
    );
    const changeSettlement = ownerSettlement.settlement;
    assert.equal(changeSettlement.status, "payment_settled");
    assert.equal(changeSettlement.next, "custom_build_changed_work");
    assert.equal(changeSettlement.changeOrderId, payableChange.changeOrderId);
    assertLiveJobLockOrder(ownerSettlementCapture.entries, {
      discovery:
        /from ss\.service_custom_build_change_checkout_attempts where id = \$1/u,
      jobId: buildJobId,
      label: "ownerCommandClaim",
      mutation:
        /insert into ss\.service_custom_build_change_reconciliation_commands/u
    });
    assertLiveJobLockOrder(ownerSettlementCapture.entries, {
      discovery:
        /from ss\.service_custom_build_change_checkout_attempts where organization_id = \$1 and id = \$2/u,
      jobId: buildJobId,
      label: "ownerSettlementTransaction",
      mutation:
        /insert into ss\.service_custom_build_change_payment_receipts/u
    });
    assert.equal(changePaymentReadbacks, 2);
    assert.equal(changeLifecycleReadbacks, 1);
    assert.deepEqual(
      await customBuildChangePayment.reconcileCheckoutCreation(
        operatorActor,
        buildJobId,
        settlementReconciliationInput
      ),
      ownerSettlement
    );
    assert.equal(changePaymentReadbacks, 2);
    assert.equal(changeLifecycleReadbacks, 1);
    for (const conflict of [
      {
        actor: operatorActor,
        jobId: randomUUID(),
        input: settlementReconciliationInput
      },
      {
        actor: operatorActor,
        jobId: buildJobId,
        input: {
          ...settlementReconciliationInput,
          organizationId: other.organizationId
        }
      },
      {
        actor: { userId: thirdOperatorId },
        jobId: buildJobId,
        input: settlementReconciliationInput
      }
    ]) {
      await assert.rejects(
        customBuildChangePayment.reconcileCheckoutCreation(
          conflict.actor,
          conflict.jobId,
          conflict.input
        ),
        (error) =>
          error.code ===
            "CUSTOM_BUILD_CHANGE_PAYMENT_RECONCILIATION_IDEMPOTENCY_CONFLICT" &&
          error.status === 409
      );
    }
    assert.deepEqual(
      await customBuildChangePayment.ingestStripeEvent(changeStripeEvent),
      changeSettlement
    );
    assert.equal(changePaymentReadbacks, 2);
    const paidChangeInvoice =
      await customBuildChangePayment.readCurrentInvoice(
        customerAssessmentScope
      );
    assert.equal(paidChangeInvoice.state, "paid");
    assert.equal(paidChangeInvoice.invoice.payment.chargeOccurred, true);
    assert.equal(paidChangeInvoice.invoice.tax.amountMinor, 2000);
    assert.equal(paidChangeInvoice.invoice.total.amountMinor, 27000);
    const effectiveChangeProjection =
      await customBuildChangeCompletion.readCustomer(
        customerAssessmentScope
      );
    assert.equal(effectiveChangeProjection.state, "building");
    assert.equal(effectiveChangeProjection.changeOrders.active, null);
    assert.equal(
      effectiveChangeProjection.changeOrders.history.at(-1).state,
      "effective"
    );

    const finalVerificationProgress =
      await customBuildProgress.recordProgress(
        operatorActor,
        buildJobId,
        {
          commandId: `custom-build-progress-${randomUUID()}`,
          customerSummary:
            "A final verification pass refreshed the completed Card Plus proof state.",
          expectedRevision: 2,
          milestones: {
            structure: "done",
            content: "done",
            responsive: "done",
            quality: "done"
          },
          nextStep:
            "Attach proof captured after this final verification revision.",
          organizationId: customer.organizationId,
          stage: "checking"
        }
      );
    assert.equal(finalVerificationProgress.progress.revision, 3);
    assert.equal(
      finalVerificationProgress.targetCompletionDate,
      retainedChangePurpose.targetCompletionDate
    );
    await assert.rejects(
      customBuildChangeCompletion.recordCompletion(
        operatorActor,
        buildJobId,
        {
          checks: completionChecks,
          commandId: `custom-build-completion-${randomUUID()}`,
          customerSummary:
            "This stale proof must not complete a newer final verification revision.",
          evidenceIds: staleEvidenceIds,
          organizationId: customer.organizationId
        }
      ),
      (error) =>
        error.code === "CUSTOM_BUILD_CHANGE_COMPLETION_CHANGED" &&
        error.status === 409
    );
    const finalDesktopBytes = completionPng(1441, 1001, 48);
    const finalPhoneBytes = completionPng(391, 845, 64);
    const finalDesktop = await customBuildChangeCompletion.uploadEvidence(
      operatorActor,
      buildJobId,
      {
        accessibleDescription:
          "Final desktop proof captured after the last verification revision.",
        commandId: `custom-build-completion-evidence-${randomUUID()}`,
        dataBase64: finalDesktopBytes.toString("base64"),
        mediaType: "image/png",
        organizationId: customer.organizationId,
        viewport: "desktop"
      }
    );
    const finalPhone = await customBuildChangeCompletion.uploadEvidence(
      operatorActor,
      buildJobId,
      {
        accessibleDescription:
          "Final phone proof captured after the last verification revision.",
        commandId: `custom-build-completion-evidence-${randomUUID()}`,
        dataBase64: finalPhoneBytes.toString("base64"),
        mediaType: "image/png",
        organizationId: customer.organizationId,
        viewport: "phone"
      }
    );
    assert.equal(finalDesktop.evidence.length, 3);
    assert.equal(finalPhone.evidence.length, 4);
    const completionEvidence = finalPhone.evidence.filter(
      (entry) => entry.progressRevision === 3
    );
    assert.equal(completionEvidence.length, 2);
    const completionEvidenceIds = completionEvidence
      .map((entry) => entry.evidenceId)
      .sort();
    const completionCommand = {
      checks: completionChecks,
      commandId: `custom-build-completion-${randomUUID()}`,
      customerSummary:
        "The approved Card Plus scope passed desktop, phone, links, contact, and accessibility checks.",
      evidenceIds: completionEvidenceIds,
      organizationId: customer.organizationId
    };
    const preCompletionFinal = await pool.query(
      `select
         (select count(*)::int
          from ss.service_custom_build_final_obligations
          where job_id = $1) as obligations,
         (select count(*)::int
          from ss.service_custom_build_final_invoices
          where job_id = $1) as invoices,
         (select count(*)::int
          from ss.service_custom_build_final_zero_balance_clearances
          where job_id = $1) as clearances`,
      [buildJobId]
    );
    assert.deepEqual(preCompletionFinal.rows[0], {
      obligations: 0,
      invoices: 0,
      clearances: 0
    });
    const completionRaceEntered = deferred();
    const progressRaceEntered = deferred();
    const raceAuthority = (entered, blockingQuery) => ({
      async service(context, work) {
        const transactionClient = await pool.connect();
        try {
          await transactionClient.query("begin");
          await transactionClient.query("set local role service_role");
          await setActor(
            transactionClient,
            context.actorKind,
            { organizationId: context.organizationId },
            context.userId
          );
          const backend = await transactionClient.query(
            "select pg_backend_pid()::int as pid"
          );
          const backendPid = backend.rows[0].pid;
          const value = await work({
            query(text, values) {
              if (blockingQuery.test(String(text))) {
                entered.resolve(backendPid);
              }
              return transactionClient.query(text, values);
            }
          });
          await transactionClient.query("commit");
          return value;
        } catch (error) {
          await transactionClient.query("rollback").catch(() => {});
          throw error;
        } finally {
          transactionClient.release();
        }
      }
    });
    const completionRaceService =
      createPostgresCustomServicesCustomBuildChangeCompletion({
        authority: raceAuthority(
          completionRaceEntered,
          /pg_advisory_xact_lock/u
        )
      });
    const progressRaceService =
      createPostgresCustomServicesCustomBuildProgress({
        authority: raceAuthority(
          progressRaceEntered,
          /insert into ss\.service_custom_build_progress_updates/u
        )
      });
    let completionLockHeld = false;
    await client.query("begin");
    try {
      await client.query(
        `select pg_advisory_xact_lock(
           hashtextextended('ss-custom-build-h1m:' || $1::text, 0)
         )`,
        [buildJobId]
      );
      completionLockHeld = true;
      const completionPromise = completionRaceService.recordCompletion(
        operatorActor,
        buildJobId,
        completionCommand
      );
      completionPromise.catch(() => {});
      const completionBackendPid = await within(
        completionRaceEntered.promise,
        "Custom-build completion race transaction did not start"
      );
      assert.equal(
        await waitForDatabaseLock(client, completionBackendPid),
        true,
        "completion did not wait on the shared H1M advisory lock"
      );
      const progressRejection = assert.rejects(
        progressRaceService.recordProgress(
          operatorActor,
          buildJobId,
          {
            commandId: `custom-build-progress-${randomUUID()}`,
            customerSummary:
              "This racing progress write must not cross the completion boundary.",
            expectedRevision: 3,
            milestones: {
              structure: "done",
              content: "done",
              responsive: "done",
              quality: "done"
            },
            nextStep:
              "The immutable completion package must remain the final work state.",
            organizationId: customer.organizationId,
            stage: "checking"
          }
        ),
        (error) =>
          error.code === "CUSTOM_BUILD_PROGRESS_CHANGED" &&
          error.status === 409
      );
      const progressBackendPid = await within(
        progressRaceEntered.promise,
        "Custom-build progress race transaction did not start"
      );
      assert.equal(
        await waitForDatabaseLock(client, progressBackendPid),
        true,
        "progress did not wait behind completion on the shared H1M lock"
      );
      await client.query("commit");
      completionLockHeld = false;
      const completedBuild = await within(
        completionPromise,
        "Custom-build completion did not win the queued finality race"
      );
      await within(
        progressRejection,
        "Racing Custom-build progress did not close after completion"
      );
      assert.equal(completedBuild.state, "ready_for_delivery");
      assert.equal(completedBuild.completion.progressRevision, 3);
      assert.equal(completedBuild.completion.evidenceIds.length, 2);
      assert.deepEqual(
        completedBuild.completion.effectiveChangeOrderDigests,
        [payableChange.quoteDigest]
      );
      assert.deepEqual(
        await customBuildChangeCompletion.recordCompletion(
          operatorActor,
          buildJobId,
          completionCommand
        ),
        completedBuild
      );
    } finally {
      if (completionLockHeld) {
        await client.query("rollback").catch(() => {});
      }
    }
    const customerCompletion =
      await customBuildChangeCompletion.readCustomer(
        customerAssessmentScope
      );
    assert.equal(customerCompletion.state, "ready_for_delivery");
    assert.equal(customerCompletion.completion.evidence.length, 2);
    const selectedEvidenceProjection =
      customerCompletion.completion.evidence.find(
        (entry) => entry.evidenceId === completionEvidenceIds[0]
      );
    assert.ok(selectedEvidenceProjection);
    const customerCompletionEvidence =
      await customBuildChangeCompletion.readCustomerEvidence(
        customerAssessmentScope,
        completionEvidenceIds[0]
      );
    assert.deepEqual(
      Buffer.from(customerCompletionEvidence.bytes),
      selectedEvidenceProjection.viewport === "desktop"
        ? finalDesktopBytes
        : finalPhoneBytes
    );
    assert.equal(
      customerCompletionEvidence.imageWidth,
      selectedEvidenceProjection.imageWidth
    );
    assert.equal(
      customerCompletionEvidence.imageHeight,
      selectedEvidenceProjection.imageHeight
    );
    const zeroFinal = await pool.query(
      `select
         obligation.id as obligation_id,
         obligation.quote_id,
         obligation.quote_revision_id,
         obligation.quote_acceptance_id,
         obligation.quote_installment_id,
         obligation.completion_package_id,
         obligation.completion_package_digest,
         to_json(obligation.effective_change_order_digests)
           as effective_change_order_digests,
         obligation.commercial_contract_digest,
         obligation.final_due_minor,
         obligation.credit_minor,
         obligation.workmanship_correction_days,
         obligation.obligation_digest,
         clearance.id as clearance_id,
         clearance.clearance_digest,
         clearance.reason,
         clearance.cleared_at,
         package.prepared_at,
         (select count(*)::int
          from ss.service_custom_build_final_invoices invoice
          where invoice.job_id = obligation.job_id) as invoice_count,
         (select count(*)::int
          from ss.service_custom_build_final_checkout_attempts attempt
          where attempt.job_id = obligation.job_id) as attempt_count,
         (select count(*)::int
          from ss.service_custom_build_final_stripe_events event
          where event.job_id = obligation.job_id) as event_count,
         (select count(*)::int
          from ss.service_custom_build_final_payment_receipts receipt
          where receipt.job_id = obligation.job_id) as receipt_count
       from ss.service_custom_build_final_obligations obligation
       join ss.service_custom_build_final_zero_balance_clearances clearance
         on clearance.organization_id = obligation.organization_id
        and clearance.obligation_id = obligation.id
       join ss.service_custom_build_completion_packages package
         on package.organization_id = obligation.organization_id
        and package.id = obligation.completion_package_id
       where obligation.job_id = $1`,
      [buildJobId]
    );
    assert.equal(zeroFinal.rowCount, 1);
    assert.equal(zeroFinal.rows[0].quote_id, replacementBuild.quote.quoteId);
    assert.equal(
      zeroFinal.rows[0].quote_revision_id,
      retainedBuildPurpose.quoteRevisionId
    );
    assert.equal(
      zeroFinal.rows[0].quote_acceptance_id,
      retainedBuildPurpose.quoteAcceptanceId
    );
    assert.equal(zeroFinal.rows[0].quote_installment_id, null);
    assert.deepEqual(
      zeroFinal.rows[0].effective_change_order_digests,
      [payableChange.quoteDigest]
    );
    assert.equal(zeroFinal.rows[0].commercial_contract_digest, CONTRACT_DIGEST);
    assert.equal(Number(zeroFinal.rows[0].final_due_minor), 0);
    assert.equal(Number(zeroFinal.rows[0].credit_minor), 0);
    assert.equal(zeroFinal.rows[0].workmanship_correction_days, 30);
    assert.match(zeroFinal.rows[0].obligation_digest, /^[0-9a-f]{64}$/u);
    assert.match(zeroFinal.rows[0].clearance_digest, /^[0-9a-f]{64}$/u);
    assert.equal(
      zeroFinal.rows[0].reason,
      "accepted_quote_has_no_final_balance"
    );
    assert.equal(
      new Date(zeroFinal.rows[0].cleared_at).toISOString(),
      new Date(zeroFinal.rows[0].prepared_at).toISOString()
    );
    assert.deepEqual(
      {
        invoices: zeroFinal.rows[0].invoice_count,
        attempts: zeroFinal.rows[0].attempt_count,
        events: zeroFinal.rows[0].event_count,
        receipts: zeroFinal.rows[0].receipt_count
      },
      { invoices: 0, attempts: 0, events: 0, receipts: 0 }
    );

    const zeroHandoffCommandId =
      `custom-build-v47-zero-handoff-${randomUUID()}`;
    const zeroHandoffSummary =
      "The completed Card Plus build and its final customer files are ready with no remaining balance.";
    const zeroDeliveryManifest = {
      items: [
        {
          label: "Card Plus website package",
          description:
            "The reviewed Card Plus website and its launch-ready files."
        }
      ]
    };
    const zeroHandoffParameters = [
      buildJobId,
      zeroHandoffCommandId,
      customer.organizationId,
      zeroFinal.rows[0].completion_package_digest,
      zeroFinal.rows[0].obligation_digest,
      zeroHandoffSummary,
      JSON.stringify(zeroDeliveryManifest)
    ];
    const zeroHandoffSql =
      `select *
       from ss.create_service_custom_build_handoff(
         $1, $2, $3, $4, $5, $6, $7::jsonb
       )`;

    await client.query("begin");
    try {
      const noCapabilityOperatorId = randomUUID();
      await client.query(
        "insert into auth.users (id, email) values ($1, $2)",
        [
          noCapabilityOperatorId,
          `v47-no-capability-${noCapabilityOperatorId}@example.test`
        ]
      );
      await insertRow(client, "operator_profiles", {
        user_id: noCapabilityOperatorId,
        display_label: "v47 no-capability operator",
        state: "held",
        authorized_by_user_id: secondOperatorId,
        authorized_at: new Date().toISOString()
      });
      await client.query("set local role service_role");
      await setActor(
        client,
        "operator",
        customer,
        noCapabilityOperatorId
      );
      await expectRejected(
        client,
        () => client.query(zeroHandoffSql, zeroHandoffParameters),
        /lacks operator capabilities/iu
      );
    } finally {
      await client.query("rollback");
    }

    await client.query("begin");
    try {
      await client.query("set local role service_role");
      await setActor(client, "operator", customer, secondOperatorId);
      await expectRejected(
        client,
        () => client.query(
          zeroHandoffSql,
          [
            ...zeroHandoffParameters.slice(0, 3),
            "f".repeat(64),
            ...zeroHandoffParameters.slice(4)
          ]
        ),
        /lacks exact completion and financial clearance/iu
      );
      await expectRejected(
        client,
        () => insertRow(client, "service_documents", {
          id: randomUUID(),
          organization_id: customer.organizationId,
          project_id: customer.projectId,
          case_id: paidJob.caseId,
          document_kind: "handoff",
          object_key:
            `service-documents/${customer.organizationId}/` +
            `${customer.projectId}/wrong-handoff-path.json`,
          content_digest: "e".repeat(64),
          media_type: "application/json",
          byte_count: 2,
          visibility: "customer",
          retention_class: "project",
          created_by_kind: "operator",
          created_by_user_id: secondOperatorId
        }),
        /lacks bounded authority/iu
      );
    } finally {
      await client.query("rollback");
    }

    const firstHandoffEntered = deferred();
    const secondHandoffEntered = deferred();
    const runZeroHandoff = async (entered) => {
      const transactionClient = new Client({ connectionString: DATABASE_URL });
      try {
        await transactionClient.connect();
        await transactionClient.query("begin");
        await transactionClient.query("set local role service_role");
        await setActor(
          transactionClient,
          "operator",
          customer,
          secondOperatorId
        );
        const backend = await transactionClient.query(
          "select pg_backend_pid()::int as pid"
        );
        entered.resolve(backend.rows[0].pid);
        const result = await transactionClient.query(
          zeroHandoffSql,
          zeroHandoffParameters
        );
        await transactionClient.query("set constraints all immediate");
        await transactionClient.query("commit");
        return result.rows[0];
      } catch (error) {
        await transactionClient.query("rollback").catch(() => {});
        throw error;
      } finally {
        await transactionClient.end();
      }
    };

    await client.query("begin");
    await client.query(
      `select pg_advisory_xact_lock(
         hashtextextended('ss-custom-build-h1m:' || $1::text, 0)
       )`,
      [buildJobId]
    );
    const firstHandoffPromise = runZeroHandoff(firstHandoffEntered);
    const secondHandoffPromise = runZeroHandoff(secondHandoffEntered);
    firstHandoffPromise.catch(() => {});
    secondHandoffPromise.catch(() => {});
    const firstHandoffPid = await within(
      firstHandoffEntered.promise,
      "first duplicate-handoff transaction did not start"
    );
    const secondHandoffPid = await within(
      secondHandoffEntered.promise,
      "second duplicate-handoff transaction did not start"
    );
    assert.equal(
      await waitForDatabaseLock(client, firstHandoffPid),
      true,
      "first handoff did not wait on the shared H1M lock"
    );
    assert.equal(
      await waitForDatabaseLock(client, secondHandoffPid),
      true,
      "second handoff did not wait on the shared H1M lock"
    );
    await client.query("commit");
    const [firstZeroHandoff, secondZeroHandoff] = await Promise.all([
      within(firstHandoffPromise, "first duplicate handoff did not finish"),
      within(secondHandoffPromise, "second duplicate handoff did not replay")
    ]);
    assert.deepEqual(secondZeroHandoff, firstZeroHandoff);

    const zeroHandoffStored = await pool.query(
      `select
         receipt.*,
         document.object_key,
         document.content_digest,
         document.byte_count,
         convert_from(payload.payload, 'UTF8')::jsonb as payload_json,
         extract(epoch from (
           receipt.workmanship_ends_at - receipt.workmanship_starts_at
         ))::bigint as workmanship_elapsed_seconds
       from ss.service_custom_build_handoff_receipts receipt
       join ss.service_documents document
         on document.organization_id = receipt.organization_id
        and document.id = receipt.document_id
       join ss.service_document_payloads payload
         on payload.organization_id = receipt.organization_id
        and payload.document_id = receipt.document_id
       where receipt.job_id = $1`,
      [buildJobId]
    );
    assert.equal(zeroHandoffStored.rowCount, 1);
    const zeroHandoffRow = zeroHandoffStored.rows[0];
    assert.equal(
      zeroHandoffRow.financial_clearance_kind,
      "zero_balance_clearance"
    );
    assert.equal(zeroHandoffRow.final_payment_receipt_id, null);
    assert.equal(
      zeroHandoffRow.zero_balance_clearance_id,
      zeroFinal.rows[0].clearance_id
    );
    assert.equal(zeroHandoffRow.final_invoice_id, null);
    assert.equal(Number(zeroHandoffRow.final_due_minor), 0);
    assert.equal(zeroHandoffRow.workmanship_interval_bounds, "[)");
    assert.equal(
      Number(zeroHandoffRow.workmanship_elapsed_seconds),
      30 * 24 * 60 * 60
    );
    assert.equal(
      zeroHandoffRow.object_key,
      `service-documents/${customer.organizationId}/` +
        `${customer.projectId}/custom-build-jobs/${buildJobId}/` +
        `handoff/${zeroHandoffRow.document_id}.json`
    );
    assert.equal(
      zeroHandoffRow.content_digest,
      zeroHandoffRow.document_content_digest
    );
    assert.equal(
      Number(zeroHandoffRow.byte_count),
      Number(zeroHandoffRow.document_byte_count)
    );
      assert.deepEqual(
        zeroHandoffRow.payload_json.deliveryManifest,
        zeroDeliveryManifest.items
    );
    assert.equal(
      zeroHandoffRow.payload_json.financialClearance.kind,
      "zero_balance_clearance"
    );
    assert.equal(
        zeroHandoffRow.payload_json.handoff.workmanship.coverage,
      "[start,end)"
    );
    assert.doesNotMatch(
      JSON.stringify(zeroHandoffRow.payload_json),
      /(?:cs|pi|ch|cus)_test_/u
    );

    await client.query("begin");
    try {
      await client.query("set local role service_role");
      await setActor(client, "operator", customer, secondOperatorId);
      await expectRejected(
        client,
        () => insertRow(client, "service_custom_build_progress_updates", {
          organization_id: customer.organizationId,
          project_id: customer.projectId,
          case_id: paidJob.caseId,
          customer_user_id: customer.userId,
          job_id: buildJobId,
          expected_revision: 3,
          revision: 4,
          stage: "checking",
          structure_milestone: "done",
          content_milestone: "done",
          responsive_milestone: "done",
          quality_milestone: "done",
          customer_summary:
            "This write must remain closed after immutable handoff.",
          next_step: "No post-handoff progress mutation is permitted.",
          created_by_operator_user_id: secondOperatorId,
          command_id: `custom-build-v47-closed-${randomUUID()}`,
          request_digest: "a".repeat(64),
          recorded_at: new Date().toISOString(),
          created_at: new Date().toISOString()
        }),
        /closed by immutable handoff/iu
      );
      await expectRejected(
        client,
        () => insertRow(client, "service_custom_build_work_requests", {
          organization_id: customer.organizationId,
          project_id: customer.projectId,
          case_id: paidJob.caseId,
          customer_user_id: customer.userId,
          job_id: buildJobId,
          request_kind: "customer_decision",
          title: "Closed handoff request",
          customer_message:
            "This request must not reopen a handed-off Custom build.",
          safe_instructions:
            "No response is needed because the immutable handoff is complete.",
          target_date_impact: "none",
          expected_progress_revision: 3,
          created_by_operator_user_id: secondOperatorId,
          create_command_id: `custom-build-v47-closed-${randomUUID()}`,
          create_digest: "b".repeat(64)
        }),
        /closed by immutable handoff/iu
      );
      await expectRejected(
        client,
        () => insertRow(client, "service_access_requests", {
          organization_id: customer.organizationId,
          project_id: customer.projectId,
          case_id: paidJob.caseId,
          customer_user_id: customer.userId,
          requested_by_operator_user_id: secondOperatorId,
          provider_label: "Spaceship",
          account_label: "Customer domain account",
          delegated_role: "DNS manager",
          reason_code: "custom_build_execution",
          state: "drafted",
          expires_at: isoAfter({ days: 7 }),
          job_id: buildJobId
        }),
        /closed by immutable handoff/iu
      );
      await expectRejected(
        client,
        () => insertRow(
          client,
          "service_custom_build_final_checkout_attempts",
          {
            id: randomUUID(),
            organization_id: customer.organizationId,
            project_id: customer.projectId,
            customer_user_id: customer.userId,
            job_id: buildJobId,
            obligation_id: zeroFinal.rows[0].obligation_id,
            completion_package_id:
              zeroFinal.rows[0].completion_package_id,
            invoice_id: randomUUID(),
            command_id: `custom-build-v47-closed-${randomUUID()}`,
            provider: "stripe",
            purpose: "custom_build_final",
            purpose_digest: "c".repeat(64),
            obligation_digest: zeroFinal.rows[0].obligation_digest,
            completion_package_digest:
              zeroFinal.rows[0].completion_package_digest,
            invoice_digest: "d".repeat(64),
            accepted_quote_digest: retainedBuildPurpose.acceptedQuoteDigest,
            accepted_disclosure_digest:
              retainedBuildPurpose.acceptedDisclosureDigest,
            expected_subtotal_minor: 1,
            currency: "USD",
            tax_mode: "automatic",
            provider_request_expires_at: isoAfter({ hours: 1 }),
            state: "provider_pending",
            provider_effect_certainty: "ambiguous"
          }
        ),
        /closed by immutable handoff/iu
      );
    } finally {
      await client.query("rollback");
    }

    const retainedBuildPaymentClaims = await pool.query(
      `select purpose, provider_object_kind, provider_object_id
       from ss.service_custom_build_stripe_payment_claims
       where organization_id = $1
         and purpose in ('custom_build_start', 'custom_build_change')
       order by purpose, provider_object_kind`,
      [customer.organizationId]
    );
    assert.deepEqual(
      retainedBuildPaymentClaims.rows.map((row) => ({
        kind: row.provider_object_kind,
        purpose: row.purpose
      })),
      [
        { kind: "checkout_session", purpose: "custom_build_change" },
        { kind: "payment_intent", purpose: "custom_build_change" },
        { kind: "stripe_event", purpose: "custom_build_change" },
        { kind: "checkout_session", purpose: "custom_build_start" },
        { kind: "payment_intent", purpose: "custom_build_start" },
        { kind: "stripe_event", purpose: "custom_build_start" }
      ]
    );
    await assert.rejects(
      customBuildChangeCompletion.issueChangeOrder(
        operatorActor,
        buildJobId,
        {
          ...changeIssue,
          commandId: `custom-build-change-${randomUUID()}`
        }
      ),
      (error) =>
        error.code === "CUSTOM_BUILD_CHANGE_COMPLETION_CHANGED" &&
        error.status === 409
    );
    await assert.rejects(
      customBuildProgress.recordProgress(
        operatorActor,
        buildJobId,
        {
          commandId: `custom-build-progress-${randomUUID()}`,
          customerSummary:
            "A completed build must reject any later progress mutation.",
          expectedRevision: 3,
          milestones: {
            structure: "done",
            content: "done",
            responsive: "done",
            quality: "done"
          },
          nextStep: "No later work-state mutation is permitted.",
          organizationId: customer.organizationId,
          stage: "checking"
        }
      ),
      (error) =>
        error.code === "CUSTOM_BUILD_PROGRESS_CHANGED" &&
        error.status === 409
    );
    await assert.rejects(
      customBuildProgress.openRequest(
        operatorActor,
        buildJobId,
        {
          access: null,
          commandId: `custom-build-request-${randomUUID()}`,
          customerMessage:
            "This request must not reopen a completed Custom build.",
          expectedProgressRevision: 3,
          organizationId: customer.organizationId,
          requestKind: "customer_decision",
          safeInstructions:
            "No response is required because completion is already sealed.",
          targetDateImpact: "none",
          title: "Do not reopen completed work"
        }
      ),
      (error) =>
        error.code === "CUSTOM_BUILD_PROGRESS_CHANGED" &&
        error.status === 409
    );
    await assert.rejects(
      customBuildProgress.openRequest(
        operatorActor,
        buildJobId,
        {
          access: {
            accountLabel: "Avery Studio domain account",
            delegatedRole: "DNS manager",
            expiresAt: isoAfter({ days: 7 }),
            providerLabel: "Spaceship"
          },
          commandId: `custom-build-request-${randomUUID()}`,
          customerMessage:
            "A completed build must not create a delegated-access request.",
          expectedProgressRevision: 3,
          organizationId: customer.organizationId,
          requestKind: "delegated_access",
          safeInstructions:
            "No access action is permitted after the completion package.",
          targetDateImpact: "none",
          title: "Do not reopen access after completion"
        }
      ),
      (error) =>
        error.code === "CUSTOM_BUILD_PROGRESS_CHANGED" &&
        error.status === 409
    );

    assert.equal(
      (await assessmentWork.readCustomerReport(customerAssessmentScope))
        .credit.state,
      "settled"
    );
    await assert.rejects(
      customBuild.voidQuote(
        operatorActor,
        replacementBuild.quote.quoteId,
        {
          commandId: `custom-build-void-${randomUUID()}`,
          organizationId: customer.organizationId,
          reason:
            "A paid Custom build must never release its consumed assessment credit."
        }
      ),
      (error) =>
        error.code === "custom_build_changed" ||
        error.code === "custom_build_repository_conflict" ||
        error.code === "CUSTOM_BUILD_PAYMENT_REPOSITORY_CONFLICT"
    );

    const customBuildCounts = await pool.query(
      `select
         (select count(*)::int
          from ss.service_custom_build_quotes
          where source_job_id = $1) as quotes,
         (select count(*)::int
          from ss.service_credit_applications application
          join ss.service_custom_build_quotes quote
            on quote.id = application.quote_id
          where quote.source_job_id = $1
            and application.state = 'released') as released_credits,
         (select count(*)::int
          from ss.service_credit_applications application
          join ss.service_custom_build_quotes quote
            on quote.id = application.quote_id
          where quote.source_job_id = $1
            and application.state in (
              'reserved', 'settled', 'reconciliation_required'
            )) as active_credits,
         (select count(*)::int
          from ss.service_custom_build_jobs job
          join ss.service_custom_build_quotes quote
            on quote.id = job.quote_id
          where quote.source_job_id = $1
            and job.state = 'open') as build_jobs`,
      [paidJob.jobId]
    );
    assert.deepEqual(customBuildCounts.rows[0], {
      quotes: 2,
      released_credits: 1,
      active_credits: 1,
      build_jobs: 1
    });

    await assert.rejects(
      assessmentWork.uploadEvidence(operatorActor, paidJob.jobId, {
        ...staleDesktopInput,
        commandId: `assessment-evidence-${randomUUID()}`
      }),
      (error) => error.code === "ASSESSMENT_WORK_CHANGED"
    );
    await assert.rejects(
      assessmentWork.putFinding(operatorActor, paidJob.jobId, 1, {
        ...revisedFindingInput,
        commandId: `assessment-finding-${randomUUID()}`,
        expectedRevision: 2
      }),
      (error) => error.code === "ASSESSMENT_WORK_CHANGED"
    );
    const deliveryCounts = await pool.query(
      `select
         (select count(*)::int from ss.service_assessment_reports
           where job_id = $1) as reports,
         (select count(*)::int from ss.service_assessment_report_findings
           where job_id = $1) as report_findings,
         (select count(*)::int from ss.service_credit_grants
           where source_job_id = $1 and amount_minor = 20000) as credits,
         (select count(*)::int from ss.service_assessment_evidence
           where job_id = $1) as evidence`,
      [paidJob.jobId]
    );
    assert.deepEqual(deliveryCounts.rows[0], {
      reports: 1,
      report_findings: 1,
      credits: 1,
      evidence: 5
    });
  } finally {
    await client.query("rollback").catch(() => {});
    client.release();
    await pool.end();
  }
});
