import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  createCareCapacityAllocation,
  createCareContractRegistration,
  createCarePeriodClose,
  createCarePeriodOpen,
  createCareScopeClaim,
  createCareTicketOpen,
  createCareTicketTransition
} from "../../hosted/care-core.mjs";
import { createPostgresCareCoreRepository } from
  "../../hosted/care-core-postgres.mjs";
import { createCanonicalPostgresAuthority } from
  "../../hosted/repository-postgres.mjs";
import { digest } from "../../hosted/security.mjs";

const OUTSIDE_MANAGEMENT_CATALOG_ID =
  "00000000-0000-4000-8000-000000001212";

function systemActor(organizationId) {
  return Object.freeze({
    actorId: null,
    actorKind: "system",
    organizationId
  });
}

function commandBase(scope, commandId, recordedAt) {
  return {
    actor: systemActor(scope.organization_id),
    commandId,
    recordedAt
  };
}

async function expectCode(work, code) {
  await assert.rejects(work, (error) => error?.code === code);
}

async function supportTicket(pool, scope, subject) {
  const id = randomUUID();
  await pool.query(
    `insert into ss.support_tickets (
       id, organization_id, project_id, opened_by_user_id, subject,
       state, created_at, updated_at
     ) values ($1, $2, $3, $4, $5, 'open', clock_timestamp(), clock_timestamp())`,
    [
      id, scope.organization_id, scope.project_id,
      scope.customer_user_id, subject
    ]
  );
  return id;
}

export async function verifyCareCorePostgres(pool) {
  const gates = [];
  const passed = (name) => gates.push(name);
  const scope = (await pool.query(`
    select profile.organization_id, profile.project_id,
           profile.customer_user_id
      from ss.service_project_profiles profile
      join ss.organization_memberships membership
        on membership.organization_id = profile.organization_id
       and membership.user_id = profile.customer_user_id
       and membership.state = 'active'
       and membership.role in ('owner', 'admin')
     where profile.origin = 'external'
     order by profile.created_at, profile.project_id
     limit 1
  `)).rows[0];
  assert.ok(scope, "CARE-CORE proof requires the canonical external engagement fixture");

  const authority = createCanonicalPostgresAuthority({ pool });
  const repository = createPostgresCareCoreRepository({ authority });
  const readiness = await repository.readiness();
  assert.deepEqual(readiness, {
    ready: true,
    verified: true,
    kind: "care-core-postgres",
    mode: "held",
    code: null,
    customerEffects: false,
    mailEffects: false,
    paymentEffects: false,
    providerEffects: false
  });
  passed("readiness-held");

  const providerScopeDigest = digest({
    schema: "sitesourcery.care-provider-scope-fixture/v1",
    organizationId: scope.organization_id,
    projectId: scope.project_id
  });
  const at = (minute) =>
    `2026-08-11T18:${String(minute).padStart(2, "0")}:00.000Z`;
  const contractId = randomUUID();
  const contractInput = {
    ...commandBase(scope, "care.pg.contract.0001", at(0)),
    contractId,
    projectId: scope.project_id,
    customerId: scope.customer_user_id,
    catalogIdentityId: OUTSIDE_MANAGEMENT_CATALOG_ID,
    contractKind: "outside_management",
    acceptanceReferenceId: randomUUID(),
    acceptanceDigest: digest("care-acceptance-1"),
    scopeDigest: digest("care-scope-1"),
    providerScopeDigest
  };
  const contractCommand = createCareContractRegistration(contractInput);
  const contract = await repository.registerContract(contractCommand);
  assert.equal(contract.authorityState, "held");
  assert.deepEqual(contract.effects, {
    customer: false,
    payment: false,
    provider: false
  });
  passed("contract-effects-held");
  assert.deepEqual(
    await repository.registerContract(contractCommand),
    contract,
    "exact contract command replay must return one identity"
  );
  passed("contract-idempotent-replay");
  await expectCode(
    () => repository.registerContract(createCareContractRegistration({
      ...contractInput,
      acceptanceDigest: digest("changed-care-acceptance")
    })),
    "CARE_CORE_IDEMPOTENCY_CONFLICT"
  );
  passed("command-drift-rejected");

  const wrongOrganizationId = randomUUID();
  await assert.rejects(
    authority.service(
      {
        actorKind: "system",
        organizationId: wrongOrganizationId,
        isolation: "serializable"
      },
      (client) => client.query(
        `insert into ss.care_commands (
           id, organization_id, project_id, command_id, action,
           resource_kind, resource_id, actor_kind, actor_user_id,
           request_digest, result_digest, recorded_at, created_at
         ) values (
           $1, $2, $3, 'care.pg.cross-org.0001', 'contract_register',
           'contract', $4, 'system', null, $5, $6, $7, $7
         )`,
        [
          randomUUID(), scope.organization_id, scope.project_id,
          randomUUID(), digest("cross-org-request"),
          digest("cross-org-result"), at(1)
        ]
      )
    ),
    (error) => error?.code === "42501",
    "transaction-local organization mismatch must fail at the database boundary"
  );
  passed("database-cross-org-denied");
  await expectCode(
    () => repository.readContract({
      actorKind: "system",
      actorId: null,
      organizationId: wrongOrganizationId,
      contractId
    }),
    "CARE_CORE_UNAVAILABLE"
  );
  passed("read-cross-org-denied");

  const periodId = randomUUID();
  const periodInput = {
    ...commandBase(scope, "care.pg.period.open.0001", at(2)),
    periodId,
    contractId,
    projectId: scope.project_id,
    providerScopeDigest,
    providerPeriodKey: "care.pg.period.2026-08",
    startsOn: "2026-08-01",
    endsOn: "2026-09-01",
    includedUnits: 4,
    carriedUnits: 0,
    carriedFromPeriodId: null
  };
  const firstPeriodCommand = createCarePeriodOpen(periodInput);
  const firstPeriod = await repository.openPeriod(firstPeriodCommand);
  assert.equal(firstPeriod.capacity.remaining, 4);
  assert.deepEqual(
    await repository.openPeriod(firstPeriodCommand),
    firstPeriod,
    "period replay must not mint capacity"
  );
  passed("period-idempotent-replay");

  const secondContractId = randomUUID();
  await repository.registerContract(createCareContractRegistration({
    ...commandBase(scope, "care.pg.contract.0002", at(3)),
    contractId: secondContractId,
    projectId: scope.project_id,
    customerId: scope.customer_user_id,
    catalogIdentityId: OUTSIDE_MANAGEMENT_CATALOG_ID,
    contractKind: "outside_management",
    acceptanceReferenceId: randomUUID(),
    acceptanceDigest: digest("care-acceptance-2"),
    scopeDigest: digest("care-scope-2"),
    providerScopeDigest
  }));
  await expectCode(
    () => repository.openPeriod(createCarePeriodOpen({
      ...commandBase(scope, "care.pg.period.overlap.0001", at(4)),
      periodId: randomUUID(),
      contractId: secondContractId,
      projectId: scope.project_id,
      providerScopeDigest,
      providerPeriodKey: "care.pg.period.overlap.2026-08",
      startsOn: "2026-08-01",
      endsOn: "2026-09-01",
      includedUnits: 4,
      carriedUnits: 0,
      carriedFromPeriodId: null
    })),
    "CARE_CORE_CONFLICT"
  );
  passed("provider-period-overlap-rejected");

  const primaryClaimId = randomUUID();
  const scopeIdentityDigest = digest("supportability-review-scope");
  const primaryClaim = createCareScopeClaim({
    ...commandBase(scope, "care.pg.scope.primary.0001", at(5)),
    claimId: primaryClaimId,
    periodId,
    projectId: scope.project_id,
    periodStartsOn: "2026-08-01",
    periodEndsOn: "2026-09-01",
    coverageKey: "supportability_review",
    scopeIdentityDigest,
    claimMode: "primary",
    includedByClaimId: null
  });
  assert.deepEqual(await repository.claimScope(primaryClaim), {
    id: primaryClaimId,
    replayed: false
  });
  assert.deepEqual(await repository.claimScope(primaryClaim), {
    id: primaryClaimId,
    replayed: true
  });
  passed("scope-idempotent-replay");
  const includedClaimId = randomUUID();
  await repository.claimScope(createCareScopeClaim({
    ...commandBase(scope, "care.pg.scope.included.0001", at(6)),
    claimId: includedClaimId,
    periodId,
    projectId: scope.project_id,
    periodStartsOn: "2026-08-01",
    periodEndsOn: "2026-09-01",
    coverageKey: "supportability_review",
    scopeIdentityDigest,
    claimMode: "included",
    includedByClaimId: primaryClaimId
  }));
  await expectCode(
    () => repository.claimScope(createCareScopeClaim({
      ...commandBase(scope, "care.pg.scope.overlap.0001", at(7)),
      claimId: randomUUID(),
      periodId,
      projectId: scope.project_id,
      periodStartsOn: "2026-08-01",
      periodEndsOn: "2026-09-01",
      coverageKey: "supportability_review",
      scopeIdentityDigest,
      claimMode: "primary",
      includedByClaimId: null
    })),
    "CARE_CORE_CONFLICT"
  );
  passed("primary-scope-overlap-rejected");

  const supportTicketId = await supportTicket(
    pool,
    scope,
    "CARE-CORE deterministic ticket one"
  );
  const ticketId = randomUUID();
  const ticket = await repository.openTicket(createCareTicketOpen({
    ...commandBase(scope, "care.pg.ticket.open.0001", at(8)),
    ticketId,
    contractId,
    periodId,
    projectId: scope.project_id,
    supportTicketId,
    basisKind: "customer_request",
    basisReferenceId: null,
    basisDigest: digest("customer-request-basis"),
    workScopeDigest: digest("shared-root-cause")
  }));
  assert.equal(ticket.state, "open");
  assert.deepEqual(ticket.effects, { mail: false, provider: false });
  const secondSupportTicketId = await supportTicket(
    pool,
    scope,
    "CARE-CORE deterministic overlap ticket"
  );
  await expectCode(
    () => repository.openTicket(createCareTicketOpen({
      ...commandBase(scope, "care.pg.ticket.overlap.0001", at(9)),
      ticketId: randomUUID(),
      contractId,
      periodId,
      projectId: scope.project_id,
      supportTicketId: secondSupportTicketId,
      basisKind: "customer_request",
      basisReferenceId: null,
      basisDigest: digest("other-customer-request"),
      workScopeDigest: digest("shared-root-cause")
    })),
    "CARE_CORE_CONFLICT"
  );
  passed("ticket-work-overlap-rejected");
  await expectCode(
    () => repository.openTicket(createCareTicketOpen({
      ...commandBase(scope, "care.pg.ticket.false-finding.0001", at(10)),
      ticketId: randomUUID(),
      contractId,
      periodId,
      projectId: scope.project_id,
      supportTicketId: secondSupportTicketId,
      basisKind: "assessment_finding",
      basisReferenceId: randomUUID(),
      basisDigest: digest("invented-finding"),
      workScopeDigest: digest("invented-finding-work")
    })),
    "CARE_CORE_CONFLICT"
  );
  passed("false-assessment-finding-rejected");

  const allocationInput = {
    ...commandBase(scope, "care.pg.capacity.0001", at(11)),
    entryId: randomUUID(),
    periodId,
    ticketId,
    projectId: scope.project_id,
    capacitySource: "included",
    units: 2
  };
  const allocation = createCareCapacityAllocation(allocationInput);
  assert.equal((await repository.allocateCapacity(allocation)).capacity.remaining, 2);
  assert.equal((await repository.allocateCapacity(allocation)).capacity.remaining, 2);
  await expectCode(
    () => repository.allocateCapacity(createCareCapacityAllocation({
      ...commandBase(scope, "care.pg.capacity.overflow.0001", at(12)),
      entryId: randomUUID(),
      periodId,
      ticketId,
      projectId: scope.project_id,
      capacitySource: "included",
      units: 3
    })),
    "CARE_CORE_CONFLICT"
  );
  passed("capacity-idempotency-and-overflow-fenced");

  const started = createCareTicketTransition({
    ...commandBase(scope, "care.pg.ticket.start.0001", at(13)),
    ticketId,
    projectId: scope.project_id,
    expectedRevision: 1,
    transition: "start"
  });
  assert.equal((await repository.transitionTicket(started)).state, "in_progress");
  assert.equal((await repository.transitionTicket(started)).revision, 2);
  assert.equal((await repository.transitionTicket(createCareTicketTransition({
    ...commandBase(scope, "care.pg.ticket.resolve.0001", at(14)),
    ticketId,
    projectId: scope.project_id,
    expectedRevision: 2,
    transition: "resolve"
  }))).state, "resolved");
  assert.equal((await repository.transitionTicket(createCareTicketTransition({
    ...commandBase(scope, "care.pg.ticket.close.0001", at(15)),
    ticketId,
    projectId: scope.project_id,
    expectedRevision: 3,
    transition: "close"
  }))).state, "closed");
  await expectCode(
    () => repository.transitionTicket(createCareTicketTransition({
      ...commandBase(scope, "care.pg.ticket.after-close.0001", at(16)),
      ticketId,
      projectId: scope.project_id,
      expectedRevision: 4,
      transition: "start"
    })),
    "CARE_CORE_CONFLICT"
  );
  passed("ticket-lifecycle-fenced");

  const closedFirst = await repository.closePeriod(createCarePeriodClose({
    ...commandBase(scope, "care.pg.period.close.0001", at(17)),
    periodId,
    projectId: scope.project_id,
    expectedRevision: 1
  }));
  assert.equal(closedFirst.state, "closed");
  const secondPeriodId = randomUUID();
  const secondPeriod = await repository.openPeriod(createCarePeriodOpen({
    ...commandBase(scope, "care.pg.period.open.0002", at(18)),
    periodId: secondPeriodId,
    contractId,
    projectId: scope.project_id,
    providerScopeDigest,
    providerPeriodKey: "care.pg.period.2026-09",
    startsOn: "2026-09-01",
    endsOn: "2026-10-01",
    includedUnits: 4,
    carriedUnits: 2,
    carriedFromPeriodId: periodId
  }));
  assert.deepEqual(secondPeriod.capacity, {
    carried: 2,
    included: 4,
    usedCarried: 0,
    usedIncluded: 0,
    remaining: 6
  });
  const supportTicketTwoId = await supportTicket(
    pool,
    scope,
    "CARE-CORE deterministic ticket two"
  );
  const ticketTwoId = randomUUID();
  await repository.openTicket(createCareTicketOpen({
    ...commandBase(scope, "care.pg.ticket.open.0002", at(19)),
    ticketId: ticketTwoId,
    contractId,
    periodId: secondPeriodId,
    projectId: scope.project_id,
    supportTicketId: supportTicketTwoId,
    basisKind: "monitoring_incident",
    basisReferenceId: null,
    basisDigest: digest("monitoring-incident"),
    workScopeDigest: digest("monitoring-work")
  }));
  await expectCode(
    () => repository.allocateCapacity(createCareCapacityAllocation({
      ...commandBase(scope, "care.pg.capacity.order.0001", at(20)),
      entryId: randomUUID(),
      periodId: secondPeriodId,
      ticketId: ticketTwoId,
      projectId: scope.project_id,
      capacitySource: "included",
      units: 1
    })),
    "CARE_CORE_CONFLICT"
  );
  await repository.allocateCapacity(createCareCapacityAllocation({
    ...commandBase(scope, "care.pg.capacity.carried.0001", at(21)),
    entryId: randomUUID(),
    periodId: secondPeriodId,
    ticketId: ticketTwoId,
    projectId: scope.project_id,
    capacitySource: "carried",
    units: 2
  }));
  await repository.allocateCapacity(createCareCapacityAllocation({
    ...commandBase(scope, "care.pg.capacity.included.0002", at(22)),
    entryId: randomUUID(),
    periodId: secondPeriodId,
    ticketId: ticketTwoId,
    projectId: scope.project_id,
    capacitySource: "included",
    units: 1
  }));
  await repository.closePeriod(createCarePeriodClose({
    ...commandBase(scope, "care.pg.period.close.0002", at(23)),
    periodId: secondPeriodId,
    projectId: scope.project_id,
    expectedRevision: 1
  }));
  await expectCode(
    () => repository.openPeriod(createCarePeriodOpen({
      ...commandBase(scope, "care.pg.period.rollover-cascade.0001", at(24)),
      periodId: randomUUID(),
      contractId,
      projectId: scope.project_id,
      providerScopeDigest,
      providerPeriodKey: "care.pg.period.cascade.2026-10",
      startsOn: "2026-10-01",
      endsOn: "2026-11-01",
      includedUnits: 4,
      carriedUnits: 4,
      carriedFromPeriodId: secondPeriodId
    })),
    "CARE_CORE_CONFLICT"
  );
  const thirdPeriod = await repository.openPeriod(createCarePeriodOpen({
    ...commandBase(scope, "care.pg.period.open.0003", at(25)),
    periodId: randomUUID(),
    contractId,
    projectId: scope.project_id,
    providerScopeDigest,
    providerPeriodKey: "care.pg.period.2026-10",
    startsOn: "2026-10-01",
    endsOn: "2026-11-01",
    includedUnits: 4,
    carriedUnits: 3,
    carriedFromPeriodId: secondPeriodId
  }));
  assert.equal(thirdPeriod.capacity.carried, 3);
  passed("one-cycle-rollover-fenced");

  const exact = await pool.query(`
    select
      count(*) = 9 as catalog_exact,
      bool_and(availability_state = 'held'
        and not customer_effects_authorized
        and not payment_effects_authorized
        and not provider_effects_authorized) as catalog_held,
      (select count(*) from ss.care_customer_contracts
        where organization_id = $1) = 2 as contracts_exact,
      (select count(*) from ss.care_periods
        where organization_id = $1) = 3 as periods_exact,
      (select count(*) from ss.care_tickets
        where organization_id = $1) = 2 as tickets_exact,
      (select count(*) from ss.care_capacity_entries
        where organization_id = $1) = 3 as capacity_entries_exact,
      (select bool_and(c.relrowsecurity and c.relforcerowsecurity)
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'ss' and c.relname = any($2::text[])) as forced_rls
    from ss.care_catalog_identities
  `, [scope.organization_id, [
    "care_catalog_identities", "care_commands", "care_customer_contracts",
    "care_periods", "care_period_scope_claims", "care_tickets",
    "care_capacity_entries"
  ]]);
  for (const [name, passed] of Object.entries(exact.rows[0])) {
    assert.equal(passed, true, `CARE-CORE exact proof failed: ${name}`);
  }
  passed("exact-held-database-state");

  assert.deepEqual(gates, [
    "readiness-held",
    "contract-effects-held",
    "contract-idempotent-replay",
    "command-drift-rejected",
    "database-cross-org-denied",
    "read-cross-org-denied",
    "period-idempotent-replay",
    "provider-period-overlap-rejected",
    "scope-idempotent-replay",
    "primary-scope-overlap-rejected",
    "ticket-work-overlap-rejected",
    "false-assessment-finding-rejected",
    "capacity-idempotency-and-overflow-fenced",
    "ticket-lifecycle-fenced",
    "one-cycle-rollover-fenced",
    "exact-held-database-state"
  ]);

  return Object.freeze({
    assertions: gates.length,
    catalogIdentities: 9,
    contracts: 2,
    periods: 3,
    tickets: 2,
    capacityEntries: 3,
    providerEffects: false,
    paymentEffects: false,
    mailEffects: false,
    customerEffects: false
  });
}
