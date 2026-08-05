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
  projectCustomServicesAssessmentQuote
} from "../../hosted/custom-services-assessment-quote.mjs";

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
  await insertRow(client, "operator_permissions", {
    operator_user_id: operatorUserId,
    capability: "service_quote_author",
    state: "held",
    granted_by_user_id: controlUserId,
    granted_at: isoAfter()
  });
  const grant = await insertRow(
    client,
    "service_operator_authority_events",
    {
      operator_user_id: operatorUserId,
      capability: "service_quote_author",
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
  const pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
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

    const invoiceRepositoryContexts = [];
    const invoiceRepository =
      createPostgresCustomServicesInvoiceRepository({
        authority: {
          async service(context, work) {
            invoiceRepositoryContexts.push(structuredClone(context));
            return work(client);
          }
        }
      });
    const invoiceProjection =
      await invoiceRepository.readCurrentInvoice(quoteScope);
    assert.equal(
      invoiceProjection.schema,
      "sitesourcery.custom-services-assessment-invoice/v1"
    );
    assert.equal(invoiceProjection.state, "tax_calculation_pending");
    assert.equal(invoiceProjection.invoice.subtotal.amountMinor, 20000);
    assert.equal(invoiceProjection.invoice.tax.amountMinor, null);
    assert.equal(invoiceProjection.invoice.total.amountMinor, null);
    assert.equal(invoiceProjection.invoice.payment.checkoutAvailable, false);
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

    const materialized = await client.query(
      `select
         (select count(*)::int from ss.service_invoices
           where quote_id = $1) as invoices,
         (select count(*)::int from ss.service_invoice_lines line
           join ss.service_invoices invoice on invoice.id = line.invoice_id
          where invoice.quote_id = $1) as lines,
         (select count(*)::int from ss.service_payment_reservations reservation
           join ss.service_invoices invoice on invoice.id = reservation.invoice_id
          where invoice.quote_id = $1) as reservations`,
      [quoteId]
    );
    assert.deepEqual(materialized.rows[0], {
      invoices: 1,
      lines: 1,
      reservations: 1
    });

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
  } finally {
    await client.query("rollback").catch(() => {});
    client.release();
    await pool.end();
  }
});
