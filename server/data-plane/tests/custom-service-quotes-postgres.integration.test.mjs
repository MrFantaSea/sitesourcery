import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

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
  projectCustomServicesAssessmentQuote
} from "../../hosted/custom-services-assessment-quote.mjs";
import { digest } from "../../hosted/security.mjs";

const { Pool } = pg;
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

async function seedOperator(client, label) {
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
  for (const capability of [
    "service_quote_author",
    "service_job_manage",
    "service_document_manage"
  ]) {
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
    const firstOperatorId = await seedOperator(client, "first");
    const secondOperatorId = await seedOperator(client, "second");

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
              checkoutId: "cs_test_service_assessment_1",
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
              checkoutId: "cs_test_service_assessment_concurrent",
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
              checkoutId: "cs_test_service_assessment_persistence",
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
              clock_timestamp() - interval '200 milliseconds',
              clock_timestamp() - interval '200 milliseconds'
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
              checkout_session_id = 'cs_test_service_assessment_expired',
              checkout_url =
                'https://checkout.stripe.com/c/pay/service_assessment_expired',
              expires_at =
                clock_timestamp() - interval '100 milliseconds'
        where id = $1`,
      [expiredAttemptId]
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
            "cs_test_service_assessment_replacement",
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
          "cs_test_service_assessment_expired"
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
                "cs_test_service_assessment_lock_order",
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
      "assessment lock-order provider was not reached"
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
        "cs_test_service_assessment_lock_order",
      paymentIntentId:
        "pi_test_service_assessment_settlement",
      customerId: "cus_test_service_assessment_settlement",
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
      id: "evt_test_service_assessment_settlement",
      type: "checkout.session.completed",
      livemode: false,
      api_version: "2026-06-24.dahlia",
      created: Math.floor(
        (Date.parse(settlementNow) - 500) / 1000
      ),
      data: {
        object: {
          id: "cs_test_service_assessment_lock_order",
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
            "cs_test_service_assessment_lock_order",
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
      id: "evt_test_service_assessment_mismatch"
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
      id: "evt_test_service_assessment_settlement_alias"
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
        "cs_test_service_assessment_lock_order",
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
    foreignEvent.id = "evt_test_service_assessment_foreign";
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

    const customBuildAuthority = {
        async service(context, work) {
          const transactionClient = await pool.connect();
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
                context.userId === secondOperatorId
                  ? "operator"
                  : "customer",
                {
                  organizationId:
                    context.organizationId ?? customer.organizationId
                },
                context.userId
              );
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
    const buildCheckoutId = "cs_test_custom_build_start_1";
    const buildCustomerId = "cus_test_service_assessment_settlement";
    const buildPaymentIntentId = "pi_test_custom_build_start_1";
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
      id: "evt_test_custom_build_start_1",
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
