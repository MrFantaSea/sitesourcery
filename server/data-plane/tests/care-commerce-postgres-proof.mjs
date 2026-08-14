import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  createPostgresCareCommerceEligibility,
  createPostgresCareCommerceRepository
} from "../../hosted/care-commerce-postgres.mjs";
import { createHeldCareCommerceService } from
  "../../hosted/care-commerce.mjs";
import { createCareCommerceHttpBoundary } from
  "../../hosted/care-commerce-http.mjs";
import { createCanonicalPostgresAuthority } from
  "../../hosted/repository-postgres.mjs";

async function expectCode(work, code) {
  await assert.rejects(work, (error) => error?.code === code);
}

export async function verifyCareCommercePostgres(pool) {
  const gates = [];
  const passed = (name) => gates.push(name);
  const scope = (await pool.query(`
    select contract.organization_id, contract.project_id,
           contract.customer_user_id, contract.id as contract_id,
           period.id as period_id, catalog.service_key
      from ss.care_customer_contracts contract
      join ss.care_catalog_identities catalog
        on catalog.id = contract.catalog_identity_id
      join ss.care_periods period
        on period.organization_id = contract.organization_id
       and period.project_id = contract.project_id
       and period.contract_id = contract.id
       and period.state = 'open'
     where catalog.commercial_authority_state = 'exact_held'
       and contract.authority_state = 'held'
     order by period.created_at desc, period.id
     limit 1
  `)).rows[0];
  assert.ok(scope, "CARE-COMMERCE proof requires one open exact-held Care period");

  const operatorId = randomUUID();
  const authorizerId = randomUUID();
  await pool.query(
    `insert into auth.users (id, email) values ($1, $2), ($3, $4)`,
    [
      operatorId, `care-commerce-operator-${operatorId}@example.test`,
      authorizerId, `care-commerce-authorizer-${authorizerId}@example.test`
    ]
  );
  await pool.query(
    `insert into ss.hosted_account_profiles (user_id, display_name, state)
     values ($1, 'Care Commerce Operator', 'active')`,
    [operatorId]
  );
  await pool.query(
    `insert into ss.operator_profiles (
       user_id, display_label, state, authorized_by_user_id, authorized_at
     ) values ($1, 'Care Commerce Operator', 'held', $2, clock_timestamp())`,
    [operatorId, authorizerId]
  );
  for (const capability of [
    "service_invoice_manage", "service_management_manage"
  ]) {
    await pool.query(
      `insert into ss.operator_permissions (
         operator_user_id, capability, state, granted_by_user_id, granted_at
       ) values ($1, $2, 'held', $3, clock_timestamp())`,
      [operatorId, capability, authorizerId]
    );
    await pool.query(
      `insert into ss.service_operator_authority_events (
         operator_user_id, capability, event_sequence, event_kind,
         predecessor_event_id, recorded_by_kind, effective_at, expires_at,
         created_at
       ) values ($1, $2, 1, 'grant', null, 'deployment_control',
         clock_timestamp(), clock_timestamp() + interval '1 day', clock_timestamp())`,
      [operatorId, capability]
    );
  }

  const authority = createCanonicalPostgresAuthority({ pool });
  const eligibility = createPostgresCareCommerceEligibility({ authority });
  const repository = createPostgresCareCommerceRepository({ authority });
  const privileges = await pool.query(`
    select
      has_table_privilege('service_role', 'ss.care_commerce_quotes', 'select,insert')
        and not has_table_privilege('service_role', 'ss.care_commerce_quotes', 'update,delete')
        as quotes_minimal,
      has_table_privilege('service_role', 'ss.care_commerce_reservations', 'select,insert,update')
        and not has_table_privilege('service_role', 'ss.care_commerce_reservations', 'delete')
        as reservations_minimal,
      has_table_privilege('service_role', 'ss.care_commerce_reservation_events', 'select,insert')
        and not has_table_privilege('service_role', 'ss.care_commerce_reservation_events', 'update,delete')
        as reservation_events_minimal,
      not has_table_privilege('authenticated', 'ss.care_commerce_quotes', 'select,insert,update,delete')
        and not has_table_privilege('authenticated', 'ss.care_commerce_reservations', 'select,insert,update,delete')
        and not has_table_privilege('authenticated', 'ss.care_commerce_reservation_events', 'select,insert,update,delete')
        as authenticated_denied
  `);
  for (const [name, value] of Object.entries(privileges.rows[0])) {
    assert.equal(value, true, `CARE-COMMERCE privilege proof failed: ${name}`);
  }
  const observedAt = (await pool.query(
    "select clock_timestamp() as observed_at"
  )).rows[0].observed_at.toISOString();
  const ids = {
    quotes: [randomUUID(), randomUUID(), randomUUID()],
    reservations: [randomUUID(), randomUUID(), randomUUID()],
    next(kind) {
      const selected = kind === "care_quote" ? this.quotes : this.reservations;
      assert.ok(selected.length > 0, `unexpected exhausted ${kind} IDs`);
      return selected.shift();
    }
  };
  const service = createHeldCareCommerceService({
    eligibility,
    repository,
    ids,
    clock: { now: () => observedAt },
    mailReservations: {
      deliveryEffects: false,
      providerEffects: false,
      async readiness() {
        return { ready: true, verified: true };
      },
      async reserve() {
        assert.fail("held Care commerce PostgreSQL proof must not reserve mail");
      }
    }
  });
  const authenticated = {
    userId: operatorId,
    organizationId: scope.organization_id
  };
  const operatorScope = {
    organizationId: scope.organization_id,
    projectId: scope.project_id,
    contractId: scope.contract_id,
    periodId: scope.period_id
  };
  const eligibilityReady = await eligibility.readiness();
  const repositoryReady = await repository.readiness();
  assert.equal(eligibilityReady.ready, true,
    `Care eligibility readiness failed: ${JSON.stringify(eligibilityReady)}`);
  assert.equal(repositoryReady.ready, true,
    `Care repository readiness failed: ${JSON.stringify(repositoryReady)}`);
  const ready = await service.readiness();
  assert.equal(ready.ready, true, JSON.stringify(ready));
  assert.equal(ready.durableCommercialState, true);
  assert.equal(ready.commercialReady, false);
  assert.equal(ready.providerEffects, false);
  passed("readiness-durable-held");

  const http = createCareCommerceHttpBoundary({
    service,
    async authenticate(_request, route) {
      return {
        userId: route.audience === "customer"
          ? scope.customer_user_id
          : operatorId,
        organizationId: route.audience === "operator"
          ? route.params.organizationId
          : scope.organization_id
      };
    },
    async requireWriteGuard() {
      return true;
    }
  });
  const customerBase =
    `https://app.sitesourcery.test/api/v1/care/projects/${scope.project_id}` +
    `/contracts/${scope.contract_id}/periods/${scope.period_id}/commerce`;
  const operatorBase =
    "https://app.sitesourcery.test/api/v1/operator/care/organizations/" +
    `${scope.organization_id}/projects/${scope.project_id}` +
    `/contracts/${scope.contract_id}/periods/${scope.period_id}/commerce`;
  const customerCatalog = await http.dispatch(
    new Request(`${customerBase}/catalog`)
  );
  assert.equal(customerCatalog.status, 200);
  assert.equal((await customerCatalog.json()).audience, "customer");
  const operatorCatalog = await http.dispatch(
    new Request(`${operatorBase}/catalog`)
  );
  assert.equal(operatorCatalog.status, 200);
  assert.equal((await operatorCatalog.json()).audience, "operator");
  const httpWrongOrganizationId = randomUUID();
  await expectCode(
    () => http.dispatch(new Request(
      "https://app.sitesourcery.test/api/v1/operator/care/organizations/" +
      `${httpWrongOrganizationId}/projects/${scope.project_id}` +
      `/contracts/${scope.contract_id}/periods/${scope.period_id}` +
      "/commerce/catalog"
    )),
    "CARE_COMMERCE_UNAVAILABLE"
  );
  passed("http-customer-operator-and-cross-org-boundary");

  const quoteInput = {
    ...operatorScope,
    commandId: "care.commerce.pg.quote.0001",
    serviceKey: scope.service_key,
    priceSelection: scope.service_key === "website_rescue"
      ? { kind: "repair_units", repairUnits: 2 }
      : { kind: "supportability_review", siteClass: "simple" }
  };
  const quote = await service.createHeldQuote(authenticated, quoteInput);
  assert.deepEqual(await service.createHeldQuote(authenticated, quoteInput), quote);
  assert.equal(quote.record.payable, false);
  assert.equal(quote.record.tax.authoritative, false);
  assert.equal(quote.record.priceVersion, "SS-CUSTOM-SERVICES-2026-08-05.1");
  passed("quote-exact-and-replay-safe");

  await expectCode(
    () => service.createHeldQuote(authenticated, {
      ...quoteInput,
      priceSelection: scope.service_key === "website_rescue"
        ? { kind: "repair_units", repairUnits: 3 }
        : { kind: "onboarding_balance", siteClass: "simple" }
    }),
    "CARE_COMMERCE_IDEMPOTENCY_CONFLICT"
  );
  passed("command-fingerprint-drift-denied");

  const reservationInput = {
    ...operatorScope,
    commandId: "care.commerce.pg.reserve.0001",
    quoteId: quote.record.quoteId,
    acceptedQuoteDigest: quote.record.quoteDigest
  };
  const reservation = await service.reserveHeldInvoice(
    authenticated, reservationInput
  );
  assert.deepEqual(
    await service.reserveHeldInvoice(authenticated, reservationInput),
    reservation
  );
  assert.equal(reservation.record.providerRequest, null);
  assert.equal(reservation.record.providerEffects, false);
  passed("one-per-quote-reservation-and-replay");

  await expectCode(
    () => service.reserveHeldInvoice(authenticated, {
      ...reservationInput,
      commandId: "care.commerce.pg.reserve.overlap.0001"
    }),
    "CARE_COMMERCE_RESERVATION_OVERLAP"
  );
  passed("one-per-quote-overlap-denied");

  const cancelled = await service.cancelHeldReservation(authenticated, {
    ...operatorScope,
    commandId: "care.commerce.pg.cancel.0001",
    reservationId: reservation.record.reservationId,
    expectedRevision: 1,
    cancellationEvidenceDigest: "c".repeat(64)
  });
  assert.equal(cancelled.record.state, "cancelled");
  assert.equal(cancelled.record.providerEffectCertainty, "not_submitted");
  await expectCode(
    () => service.requestReversal(authenticated, {
      ...operatorScope,
      reservationId: reservation.record.reservationId
    }),
    "CARE_COMMERCE_REVERSAL_AUTHORITY_HELD"
  );
  passed("cancellation-and-reversal-fenced");

  const secondQuote = await service.createHeldQuote(authenticated, {
    ...quoteInput,
    commandId: "care.commerce.pg.quote.0002"
  });
  const secondReservation = await service.reserveHeldInvoice(authenticated, {
    ...operatorScope,
    commandId: "care.commerce.pg.reserve.0002",
    quoteId: secondQuote.record.quoteId,
    acceptedQuoteDigest: secondQuote.record.quoteDigest
  });
  const ambiguous = await service.markReservationAmbiguous(authenticated, {
    ...operatorScope,
    commandId: "care.commerce.pg.ambiguous.0001",
    reservationId: secondReservation.record.reservationId,
    expectedRevision: 1,
    ambiguityEvidenceDigest: "d".repeat(64)
  });
  assert.equal(ambiguous.record.state, "ambiguity_review_required");
  assert.equal(ambiguous.record.providerEffectCertainty, "ambiguous");
  passed("ambiguity-fail-closed");

  let crossOrgError = null;
  try {
    await authority.service({
      actorKind: "operator",
      userId: operatorId,
      organizationId: randomUUID(),
      isolation: "serializable"
    }, (client) => client.query(
      `insert into ss.care_commands (
         id,organization_id,project_id,command_id,action,resource_kind,
         resource_id,actor_kind,actor_user_id,request_digest,result_digest,
         recorded_at,created_at
       ) values ($1,$2,$3,'care.commerce.pg.cross-org.0001',
         'care_quote_create','commerce_quote',$4,'operator',$5,$6,$7,
         clock_timestamp(),clock_timestamp())`,
      [randomUUID(), scope.organization_id, scope.project_id,
        randomUUID(), operatorId, "e".repeat(64), "f".repeat(64)]
    ));
  } catch (error) {
    crossOrgError = error;
  }
  assert.equal(crossOrgError?.code, "42501");
  passed("database-cross-org-denied");

  let mutationError = null;
  try {
    await authority.service({
      actorKind: "operator", userId: operatorId,
      organizationId: scope.organization_id, isolation: "serializable"
    }, (client) => client.query(
      `update ss.care_commerce_quotes set state = 'held'
        where organization_id = $1 and id = $2`,
      [scope.organization_id, quote.record.quoteId]
    ));
  } catch (error) {
    mutationError = error;
  }
  assert.equal(mutationError?.code, "42501");
  passed("append-only-quote-evidence");

  const exact = await pool.query(`
    select
      (select count(*) from ss.care_commerce_quotes
        where organization_id = $1) = 2 as quotes_exact,
      (select count(*) from ss.care_commerce_reservations
        where organization_id = $1) = 2 as reservations_exact,
      (select count(*) from ss.care_commerce_reservation_events
        where organization_id = $1) = 4 as reservation_events_exact,
      (select count(*) from ss.care_commands
        where organization_id = $1 and action like 'care_%') = 6
        as commerce_commands_exact,
      (select count(distinct quote_id) from ss.care_commerce_reservations
        where organization_id = $1) = 2 as one_per_quote,
      (select bool_and(not customer_effects_authorized
        and not payment_effects_authorized and not provider_effects_authorized)
        from ss.care_commerce_reservations
        where organization_id = $1) as effects_held,
      (select bool_and(c.relrowsecurity and c.relforcerowsecurity)
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'ss' and c.relname = any($2::text[])) as forced_rls
  `, [scope.organization_id, [
    "care_commands", "care_commerce_quotes", "care_commerce_reservations",
    "care_commerce_reservation_events"
  ]]);
  for (const [name, value] of Object.entries(exact.rows[0])) {
    assert.equal(value, true, `CARE-COMMERCE exact proof failed: ${name}`);
  }
  passed("exact-held-state-and-forced-rls");

  await pool.query("begin");
  try {
    await pool.query(
      `insert into ss.deletion_requests (
         id, organization_id, project_id, requested_by_user_id,
         policy_version, state, sealed_at, accepted_term_ids,
         billing_timestamps, address_disposition,
         retained_customer_domains, removal_counts
       ) values ($1,$2,$3,null,'care-commerce-terminal-proof/v1','purging',
         clock_timestamp(),'{}'::uuid[],'{}'::jsonb,'no_address',
         '{}'::text[],'{}'::jsonb)`,
      [randomUUID(), scope.organization_id, scope.project_id]
    );
    await pool.query(
      `update ss.projects set lifecycle='deleting', name=null,
         deletion_started_at=coalesce(deletion_started_at,clock_timestamp()),
         revision=revision+1 where organization_id=$1 and id=$2`,
      [scope.organization_id, scope.project_id]
    );
    const cleanup = await pool.query(`
      select
        (select count(*) from ss.care_commerce_quotes
          where organization_id=$1 and project_id=$2)=0 as quotes_removed,
        (select count(*) from ss.care_commerce_reservations
          where organization_id=$1 and project_id=$2)=0 as reservations_removed,
        (select count(*) from ss.care_commerce_reservation_events
          where organization_id=$1 and project_id=$2)=0 as events_removed,
        (select count(*) from ss.care_commands
          where organization_id=$1 and project_id=$2
            and action in ('care_quote_create','care_invoice_reserve',
              'care_reservation_cancel','care_reservation_ambiguity_hold'))=0
          as commands_removed,
        (select removal_counts @> jsonb_build_object(
            'careCommerceCommands',6,'careCommerceQuotes',2,
            'careCommerceReservations',2,'careCommerceReservationEvents',4)
           from ss.deletion_requests where project_id=$2) as counts_sealed
    `, [scope.organization_id, scope.project_id]);
    for (const [name, value] of Object.entries(cleanup.rows[0])) {
      assert.equal(value, true, `CARE-COMMERCE cleanup proof failed: ${name}`);
    }
  } finally {
    await pool.query("rollback");
  }
  passed("terminal-cleanup-sealed-and-rollback-proven");

  assert.deepEqual(gates, [
    "readiness-durable-held",
    "http-customer-operator-and-cross-org-boundary",
    "quote-exact-and-replay-safe",
    "command-fingerprint-drift-denied",
    "one-per-quote-reservation-and-replay",
    "one-per-quote-overlap-denied",
    "cancellation-and-reversal-fenced",
    "ambiguity-fail-closed",
    "database-cross-org-denied",
    "append-only-quote-evidence",
    "exact-held-state-and-forced-rls",
    "terminal-cleanup-sealed-and-rollback-proven"
  ]);
  return Object.freeze({
    assertions: gates.length,
    quotes: 2,
    reservations: 2,
    reservationEvents: 4,
    careCommands: 6,
    providerEffects: false,
    paymentEffects: false,
    customerEffects: false
  });
}
