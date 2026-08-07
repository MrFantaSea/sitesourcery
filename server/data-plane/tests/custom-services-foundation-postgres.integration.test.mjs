import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import pg from "pg";
import {
  createPostgresCustomServicesAccountRepository
} from "../../hosted/custom-services-account-postgres.mjs";
import {
  createPostgresCustomServicesRequestRepository
} from "../../hosted/custom-services-request-postgres.mjs";

const { Pool } = pg;
const DATABASE_URL =
  process.env.SITESOURCERY_PG_CUSTOM_SERVICES_TEST_URL ?? null;

assert.ok(
  DATABASE_URL,
  "SITESOURCERY_PG_CUSTOM_SERVICES_TEST_URL is required"
);

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

async function seedAccountProject(
  client,
  { profileState = "active", organizationState = "active" } = {}
) {
  const authority = {
    userId: randomUUID(),
    organizationId: randomUUID(),
    billingPolicyId: randomUUID(),
    projectId: randomUUID()
  };
  await client.query(
    "insert into auth.users (id, email) values ($1, $2)",
    [
      authority.userId,
      `custom-services-${authority.userId}@example.test`
    ]
  );
  await insertRow(client, "hosted_account_profiles", {
    user_id: authority.userId,
    display_name: "Custom Services Customer",
    state: profileState
  });
  await insertRow(client, "billing_policies", {
    id: authority.billingPolicyId,
    policy_key: `custom-services-${authority.billingPolicyId}`,
    grace_period: "14 days",
    retention_period: "90 days",
    effective_at: "2026-08-05T00:00:00.000Z"
  });
  await insertRow(client, "organizations", {
    id: authority.organizationId,
    created_by_user_id: authority.userId,
    name: "Custom Services Test",
    state: organizationState
  });
  await insertRow(client, "organization_memberships", {
    organization_id: authority.organizationId,
    user_id: authority.userId,
    role: "owner",
    state: "active",
    accepted_at: "2026-08-05T12:00:00.000Z"
  });
  await insertRow(client, "projects", {
    id: authority.projectId,
    organization_id: authority.organizationId,
    created_by_user_id: authority.userId,
    billing_policy_id: authority.billingPolicyId,
    name: "Customer Website"
  });
  return authority;
}

async function setCustomerActor(client, authority) {
  await client.query(
    "select set_config('app.service_actor_kind', 'customer', true)"
  );
  await client.query(
    "select set_config('app.service_actor_user_id', $1, true)",
    [authority.userId]
  );
  await client.query(
    "select set_config('app.service_actor_organization_id', $1, true)",
    [authority.organizationId]
  );
}

function profileRow(authority) {
  return {
    organization_id: authority.organizationId,
    project_id: authority.projectId,
    customer_user_id: authority.userId,
    origin: "external",
    observed_hostname: "customer.example.com",
    observed_at: "2026-08-05T12:01:00.000Z",
    platform_family: "unknown",
    ownership_state: "customer_stated",
    takeover_required: true,
    takeover_state: "review_required",
    supportability_state: "not_reviewed"
  };
}

test("custom-services foundation is actor-bound and strictly pre-commerce", async () => {
  const pool = new Pool({
    connectionString: DATABASE_URL,
    max: 1
  });
  const client = await pool.connect();
  try {
    await client.query("begin");

    const contract = await client.query(
      "select ss.hosted_runtime_contract_v34() as marker"
    );
    assert.equal(
      contract.rows[0].marker,
      "canonical-ss-v34-custom-services-foundation"
    );

    const catalog = await client.query(`
      select
        policy.service_key,
        policy.unit_amount_minor,
        policy.currency,
        policy.publication_state,
        policy.commercial_contract_id,
        policy.commercial_contract_digest,
        policy.scope_boundary,
        policy.scope_boundary_digest,
        document.kind as legal_kind,
        document.version as legal_version,
        document.content_digest as legal_digest
      from ss.service_catalog_policies policy
      join ss.legal_documents document
        on document.id = policy.legal_document_id
      where policy.catalog_version = 'SS-PROFESSIONAL-2026.1'
        and policy.service_key = 'website_assessment_standard'
    `);
    assert.equal(catalog.rowCount, 1);
    assert.deepEqual(
      {
        serviceKey: catalog.rows[0].service_key,
        amountMinor: Number(catalog.rows[0].unit_amount_minor),
        currency: catalog.rows[0].currency,
        state: catalog.rows[0].publication_state,
        contractId: catalog.rows[0].commercial_contract_id,
        contractDigest: catalog.rows[0].commercial_contract_digest,
        legalKind: catalog.rows[0].legal_kind,
        legalVersion: catalog.rows[0].legal_version,
        legalDigest: catalog.rows[0].legal_digest,
        scope: catalog.rows[0].scope_boundary
      },
      {
        serviceKey: "website_assessment_standard",
        amountMinor: 20000,
        currency: "USD",
        state: "held",
        contractId: "SS-CUSTOM-SERVICES-2026-08-05.1",
        contractDigest:
          "9bb93ae1f7ed2bb7015a7d995dabdb014bd94b9362b44727a67b3580f9af57c8",
        legalKind: "custom_services",
        legalVersion: "SS-CUSTOM-SERVICES-2026-08-05.1",
        legalDigest:
          "9bb93ae1f7ed2bb7015a7d995dabdb014bd94b9362b44727a67b3580f9af57c8",
        scope: {
          expandedAssessmentState: "separately_quoted",
          maximumFindings: 10,
          maximumRepresentativePagesOrTypes: 5,
          maximumWebsites: 1,
          requiredViewports: ["desktop", "phone"]
        }
      }
    );
    assert.match(catalog.rows[0].scope_boundary_digest, /^[0-9a-f]{64}$/u);

    const coverage = await client.query(`
      select coverage_key, boundary_digest
        from ss.service_catalog_coverage
       where policy_id = '00000000-0000-4000-8000-000000000341'
       order by coverage_key
    `);
    assert.deepEqual(
      coverage.rows.map(({ coverage_key }) => coverage_key),
      [
        "public_site_inventory",
        "representative_page_review",
        "responsive_viewport_review",
        "written_assessment_report"
      ]
    );
    for (const row of coverage.rows) {
      assert.equal(row.boundary_digest, catalog.rows[0].scope_boundary_digest);
    }

    const authority = await seedAccountProject(client);
    const other = await seedAccountProject(client);
    const inactive = await seedAccountProject(client, {
      profileState: "suspended"
    });
    const operatorUserId = randomUUID();
    await client.query(
      "insert into auth.users (id, email) values ($1, $2)",
      [operatorUserId, `operator-${operatorUserId}@example.test`]
    );

    await client.query("set local role service_role");

    await expectRejected(
      client,
      () => insertRow(client, "service_project_profiles", profileRow(authority)),
      /exact customer transaction actor/iu
    );

    await setCustomerActor(client, other);
    await expectRejected(
      client,
      () => insertRow(client, "service_project_profiles", profileRow(authority)),
      /exact customer transaction actor/iu
    );

    await setCustomerActor(client, inactive);
    await expectRejected(
      client,
      () => insertRow(client, "service_project_profiles", profileRow(inactive)),
      /active first-party account/iu
    );

    await setCustomerActor(client, authority);
    await insertRow(client, "service_project_profiles", profileRow(authority));

    const addresses = await client.query(
      `select count(*)::integer as count
         from ss.project_addresses
        where organization_id = $1
          and project_id = $2`,
      [authority.organizationId, authority.projectId]
    );
    assert.equal(addresses.rows[0].count, 0);

    const caseId = randomUUID();
    await expectRejected(
      client,
      () =>
        insertRow(client, "service_cases", {
          id: caseId,
          organization_id: authority.organizationId,
          project_id: authority.projectId,
          customer_user_id: authority.userId,
          created_by_user_id: authority.userId,
          source: "account",
          state: "submitted",
          title: "Bypassed assessment state"
        }),
      /must begin as a database-managed draft/iu
    );

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
      "update ss.service_cases set title = $2 where id = $1",
      [caseId, "Bounded website assessment draft"]
    );

    const accountRepository =
      createPostgresCustomServicesAccountRepository({
        authority: {
          async service(context, work) {
            assert.deepEqual(context, {
              actorKind: "customer",
              userId: authority.userId,
              organizationId: authority.organizationId,
              readOnly: true
            });
            return work(client);
          }
        }
      });
    const updatedDraft =
      await accountRepository.readFoundationSnapshot({
        actorId: authority.userId,
        customerId: authority.userId,
        organizationId: authority.organizationId,
        projectId: authority.projectId
      });
    assert.equal(updatedDraft.serviceCase.state, "draft");
    assert.equal(updatedDraft.serviceCase.revision, 2);

    const intakeDraft = await insertRow(client, "service_intake_drafts", {
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
      important_date: "2026-10-01",
      customer_ownership_affirmed: false
    });
    assert.equal(Number(intakeDraft.rows[0].revision), 1);
    assert.match(intakeDraft.rows[0].facts_digest, /^[0-9a-f]{64}$/u);
    const revisedDraft = await client.query(
      `update ss.service_intake_drafts
          set primary_goal = $2
        where case_id = $1
        returning revision, facts_digest`,
      [caseId, "Make the website and services easier to understand."]
    );
    assert.equal(Number(revisedDraft.rows[0].revision), 2);
    assert.notEqual(
      revisedDraft.rows[0].facts_digest,
      intakeDraft.rows[0].facts_digest
    );

    await client.query("reset role");
    await client.query(
      `update ss.organization_memberships
          set role = 'editor'
        where organization_id = $1 and user_id = $2`,
      [authority.organizationId, authority.userId]
    );
    await client.query("set local role service_role");
    await setCustomerActor(client, authority);
    await assert.rejects(
      accountRepository.readFoundationSnapshot({
        actorId: authority.userId,
        customerId: authority.userId,
        organizationId: authority.organizationId,
        projectId: authority.projectId
      }),
      (error) => error?.code === "project_unavailable" && error?.status === 404
    );
    await client.query("reset role");
    await client.query(
      `update ss.organization_memberships
          set role = 'owner'
        where organization_id = $1 and user_id = $2`,
      [authority.organizationId, authority.userId]
    );
    await insertRow(client, "organization_memberships", {
      organization_id: authority.organizationId,
      user_id: other.userId,
      role: "admin",
      state: "active",
      accepted_at: "2026-08-05T00:00:00.000Z"
    });
    await client.query("set local role service_role");
    await setCustomerActor(client, {
      ...authority,
      userId: other.userId
    });
    const otherMemberRepository =
      createPostgresCustomServicesAccountRepository({
        authority: {
          async service(_context, work) {
            return work(client);
          }
        }
      });
    await assert.rejects(
      otherMemberRepository.readFoundationSnapshot({
        actorId: other.userId,
        customerId: other.userId,
        organizationId: authority.organizationId,
        projectId: authority.projectId
      }),
      (error) => error?.code === "project_unavailable" && error?.status === 404
    );
    await setCustomerActor(client, authority);

    await expectRejected(
      client,
      () =>
        insertRow(client, "service_intakes", {
          organization_id: authority.organizationId,
          project_id: authority.projectId,
          case_id: caseId,
          customer_user_id: authority.userId,
          created_by_user_id: authority.userId,
          site_display_name: "Customer Website",
          public_scheme: "https",
          public_hostname: "customer.example.com",
          primary_goal: "Make the site easier to understand.",
          approximate_public_size: "one_to_ten",
          customer_ownership_affirmed: true
        }),
      /requires a submitted customer case/iu
    );

    await client.query(
      "update ss.service_cases set state = 'submitted' where id = $1",
      [caseId]
    );
    await expectRejected(
      client,
      () =>
        client.query(
          `update ss.service_intake_drafts
              set primary_goal = 'Changed after submission'
            where case_id = $1`,
          [caseId]
        ),
      /immutable after submission or withdrawal/iu
    );

    await insertRow(client, "service_case_offerings", {
      organization_id: authority.organizationId,
      project_id: authority.projectId,
      case_id: caseId,
      customer_user_id: authority.userId,
      requested_by_user_id: authority.userId,
      policy_id: "00000000-0000-4000-8000-000000000341"
    });

    await expectRejected(
      client,
      () =>
        insertRow(client, "service_intakes", {
          organization_id: authority.organizationId,
          project_id: authority.projectId,
          case_id: caseId,
          customer_user_id: authority.userId,
          created_by_user_id: authority.userId,
          revision: 77,
          site_display_name: "Customer Website",
          public_scheme: "https",
          public_hostname: "customer.example.com",
          primary_goal: "Make the site easier to understand.",
          approximate_public_size: "one_to_ten",
          customer_ownership_affirmed: true,
          facts_digest:
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        }),
      /(?:non-DEFAULT value.*facts_digest|generated column)/iu
    );

    const callerTimestamp = "2001-01-01T00:00:00.000Z";
    await insertRow(client, "service_intakes", {
      organization_id: authority.organizationId,
      project_id: authority.projectId,
      case_id: caseId,
      customer_user_id: authority.userId,
      created_by_user_id: authority.userId,
      source: "account",
      revision: 77,
      state: "submitted",
      site_display_name: "Customer Website",
      public_scheme: "https",
      public_hostname: "customer.example.com",
      business_name: "Customer Business",
      primary_goal: "Make the website easier to understand.",
      customer_observation: "The phone layout feels crowded.",
      platform_family: "unknown",
      approximate_public_size: "one_to_ten",
      complexity_flags: ["commerce", "forms"],
      important_date: "2026-10-01",
      customer_ownership_affirmed: true,
      submitted_at: callerTimestamp,
      created_at: callerTimestamp
    });

    const intake = await client.query(
      `select
         revision,
         facts_digest,
         facts_digest = ss.service_intake_facts_digest(
           revision,
           site_display_name,
           public_scheme,
           public_hostname,
           business_name,
           primary_goal,
           customer_observation,
           platform_family,
           approximate_public_size,
           complexity_flags,
           important_date,
           customer_ownership_affirmed
         ) as digest_matches,
         submitted_at,
         created_at
       from ss.service_intakes
       where case_id = $1`,
      [caseId]
    );
    assert.equal(intake.rowCount, 1);
    assert.equal(Number(intake.rows[0].revision), 1);
    assert.match(intake.rows[0].facts_digest, /^[0-9a-f]{64}$/u);
    assert.equal(intake.rows[0].digest_matches, true);
    assert.notEqual(intake.rows[0].submitted_at.toISOString(), callerTimestamp);
    assert.notEqual(intake.rows[0].created_at.toISOString(), callerTimestamp);

    await expectRejected(
      client,
      () =>
        insertRow(client, "service_intakes", {
          organization_id: authority.organizationId,
          project_id: authority.projectId,
          case_id: caseId,
          customer_user_id: authority.userId,
          created_by_user_id: authority.userId,
          site_display_name: "Customer Website",
          public_scheme: "https",
          public_hostname: "customer.example.com",
          primary_goal: "My API key is sk_live_credentialmaterial.",
          approximate_public_size: "one_to_ten",
          customer_ownership_affirmed: true
        }),
      /service_intakes_primary_goal_check/iu
    );

    await expectRejected(
      client,
      () =>
        client.query(
          "update ss.service_cases set title = 'Changed after submit' where id = $1",
          [caseId]
        ),
      /submitted service case content is immutable/iu
    );
    await expectRejected(
      client,
      () =>
        client.query(
          "update ss.service_project_profiles set takeover_state = 'completed' where project_id = $1",
          [authority.projectId]
        ),
      /service_project_profiles.*check/iu
    );
    await expectRejected(
      client,
      () =>
        client.query(
          "update ss.service_case_offerings set state = 'accepted' where case_id = $1",
          [caseId]
        ),
      /(?:service_case_offerings.*check|service case offering transition is invalid)/iu
    );

    await client.query("reset role");
    await client.query(
      "update ss.hosted_account_profiles set state = 'suspended' where user_id = $1",
      [authority.userId]
    );
    await client.query("set local role service_role");
    await setCustomerActor(client, authority);
    await expectRejected(
      client,
      () =>
        client.query(
          "update ss.service_cases set state = 'withdrawn' where id = $1",
          [caseId]
        ),
      /active first-party account/iu
    );
    await client.query("reset role");
    await client.query(
      "update ss.hosted_account_profiles set state = 'active' where user_id = $1",
      [authority.userId]
    );
    await client.query("set local role service_role");
    await setCustomerActor(client, authority);

    const forbiddenColumns = await client.query(`
      select table_name, column_name, data_type
        from information_schema.columns
       where table_schema = 'ss'
         and table_name in (
           'service_intakes',
           'service_documents',
           'service_access_requests'
         )
         and (
           data_type = 'jsonb'
           or column_name ~
             '(password|passcode|secret|api_key|access_token|recovery_code|credential_payload)'
         )
    `);
    assert.deepEqual(forbiddenColumns.rows, []);

    const tableSecurity = await client.query(`
      select
        relation.relname,
        relation.relrowsecurity,
        relation.relforcerowsecurity,
        has_table_privilege(
          'authenticated',
          format('ss.%I', relation.relname),
          'select'
        ) as authenticated_select,
        has_table_privilege(
          'anon',
          format('ss.%I', relation.relname),
          'insert'
        ) as anon_insert,
        has_table_privilege(
          'service_role',
          format('ss.%I', relation.relname),
          'delete'
        ) as service_delete,
        has_table_privilege(
          'service_role',
          format('ss.%I', relation.relname),
          'truncate'
        ) as service_truncate
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'ss'
        and relation.relname in (
          'service_catalog_policies',
          'service_catalog_coverage',
          'service_project_profiles',
          'operator_profiles',
          'operator_permissions',
          'service_cases',
          'service_case_offerings',
          'service_intakes',
          'service_documents',
          'service_access_requests'
        )
      order by relation.relname
    `);
    assert.equal(tableSecurity.rowCount, 10);
    for (const row of tableSecurity.rows) {
      assert.equal(row.relrowsecurity, true, row.relname);
      assert.equal(row.relforcerowsecurity, true, row.relname);
      assert.equal(row.authenticated_select, false, row.relname);
      assert.equal(row.anon_insert, false, row.relname);
      assert.equal(row.service_delete, false, row.relname);
      assert.equal(row.service_truncate, false, row.relname);
    }

    for (const [table, expectedInsert] of [
      ["operator_profiles", false],
      ["operator_permissions", false],
      ["service_documents", true],
      ["service_access_requests", true]
    ]) {
      const privilege = await client.query(
        `select has_table_privilege(
           'service_role',
           $1,
           'insert'
         ) as can_insert`,
        [`ss.${table}`]
      );
      assert.equal(
        privilege.rows[0].can_insert,
        expectedInsert,
        table
      );
    }

    await expectRejected(
      client,
      () =>
        insertRow(client, "operator_profiles", {
          user_id: operatorUserId,
          display_label: "Self-issued operator",
          state: "held",
          authorized_by_user_id: operatorUserId,
          authorized_at: "2026-08-05T12:04:00.000Z"
        }),
      /permission denied/iu
    );

    const cascadingForeignKeys = await client.query(`
      select constraint_record.conname
        from pg_constraint constraint_record
        join pg_class relation
          on relation.oid = constraint_record.conrelid
        join pg_namespace namespace
          on namespace.oid = relation.relnamespace
       where namespace.nspname = 'ss'
         and relation.relname like 'service_%'
         and constraint_record.contype = 'f'
         and constraint_record.confdeltype = 'c'
    `);
    assert.deepEqual(cascadingForeignKeys.rows, []);

    await client.query("savepoint authenticated_denial");
    await client.query("set local role authenticated");
    await assert.rejects(
      () => client.query("select * from ss.service_cases"),
      /permission denied/iu
    );
    await client.query("rollback to savepoint authenticated_denial");
  } finally {
    await client.query("rollback").catch(() => {});
    client.release();
    await pool.end();
  }
});

test("customer assessment requests save, submit, withdraw, and restart through the PostgreSQL adapter", async () => {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("begin");
    const authority = await seedAccountProject(client);
    await client.query("set local role service_role");
    await setCustomerActor(client, authority);

    const contexts = [];
    const repository = createPostgresCustomServicesRequestRepository({
      authority: {
        async service(context, work) {
          contexts.push(structuredClone(context));
          return work(client);
        }
      }
    });
    const scope = {
      actorId: authority.userId,
      customerId: authority.userId,
      organizationId: authority.organizationId,
      projectId: authority.projectId
    };
    assert.equal(
      (await repository.readCurrentRequest(scope)).state,
      "not_started"
    );

    const firstSave = {
      ...scope,
      approximatePublicSize: "one_to_ten",
      businessName: "Customer Business",
      commandId: `request-save-${randomUUID()}`,
      complexityFlags: ["forms"],
      customerObservation: "The phone layout feels crowded.",
      customerOwnershipAffirmed: true,
      expectedDraftRevision: 0,
      importantDate: "2026-10-01",
      platformFamily: "wordpress",
      primaryGoal: "Make services easier to understand.",
      publicUrl: "https://customer.example.com/",
      siteDisplayName: "Customer Website"
    };
    const firstReceipt = await repository.saveDraft(firstSave);
    assert.deepEqual(await repository.saveDraft(firstSave), firstReceipt);
    const firstDraft = await repository.readCurrentRequest(scope);
    assert.equal(firstDraft.state, "draft");
    assert.equal(firstDraft.draftRevision, 1);
    assert.equal(firstDraft.website.publicUrl, firstSave.publicUrl);
    assert.equal(firstDraft.actions.submit.available, true);

    await assert.rejects(
      repository.saveDraft({
        ...firstSave,
        commandId: `request-stale-${randomUUID()}`
      }),
      (error) =>
        error?.code === "assessment_request_changed" &&
        error?.status === 409
    );

    const secondSave = {
      ...firstSave,
      commandId: `request-revise-${randomUUID()}`,
      customerObservation:
        "The phone layout and contact path both feel crowded.",
      expectedDraftRevision: 1
    };
    await repository.saveDraft(secondSave);
    const revisedDraft = await repository.readCurrentRequest(scope);
    assert.equal(revisedDraft.draftRevision, 2);
    assert.equal(
      revisedDraft.facts.customerObservation,
      secondSave.customerObservation
    );

    const submit = {
      ...scope,
      commandId: `request-submit-${randomUUID()}`,
      draftRevision: 2
    };
    const submitReceipt =
      await repository.submitCurrentRequest(submit);
    assert.deepEqual(
      await repository.submitCurrentRequest(submit),
      submitReceipt
    );
    const submitted = await repository.readCurrentRequest(scope);
    assert.equal(submitted.state, "submitted");
    assert.equal(submitted.draftRevision, null);
    assert.equal(submitted.facts.primaryGoal, firstSave.primaryGoal);
    assert.ok(submitted.submittedAt);
    assert.equal(submitted.actions.withdraw.available, true);

    const withdraw = {
      ...scope,
      commandId: `request-withdraw-${randomUUID()}`
    };
    const withdrawReceipt =
      await repository.withdrawCurrentRequest(withdraw);
    assert.deepEqual(
      await repository.withdrawCurrentRequest(withdraw),
      withdrawReceipt
    );
    const withdrawn = await repository.readCurrentRequest(scope);
    assert.equal(withdrawn.state, "withdrawn");
    assert.ok(withdrawn.withdrawnAt);
    assert.equal(withdrawn.actions.save.available, true);

    await repository.saveDraft({
      ...firstSave,
      commandId: `request-restart-${randomUUID()}`
    });
    const restarted = await repository.readCurrentRequest(scope);
    assert.equal(restarted.state, "draft");
    assert.equal(restarted.draftRevision, 1);
    assert.notEqual(restarted.caseId, withdrawn.caseId);

    assert.ok(
      contexts.some((context) => context.readOnly === true)
    );
    assert.ok(
      contexts.some((context) => context.readOnly === undefined)
    );
    assert.equal(
      contexts.every(
        (context) =>
          context.actorKind === "customer" &&
          context.userId === authority.userId &&
          context.organizationId === authority.organizationId
      ),
      true
    );
  } finally {
    await client.query("rollback").catch(() => {});
    client.release();
    await pool.end();
  }
});
