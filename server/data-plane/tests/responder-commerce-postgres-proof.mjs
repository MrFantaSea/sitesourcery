import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { createResponderCommerceHttpBoundary } from
  "../../hosted/responder-commerce-http.mjs";
import { createPostgresResponderCommerceRepository } from
  "../../hosted/responder-commerce-postgres.mjs";
import { createHeldResponderCommerceService } from
  "../../hosted/responder-commerce.mjs";
import { createCanonicalPostgresAuthority } from
  "../../hosted/repository-postgres.mjs";

async function expectCode(work, code) {
  await assert.rejects(work, (error) => error?.code === code);
}

export async function verifyResponderCommercePostgres(pool) {
  const gates = [];
  const passed = (name) => gates.push(name);
  const scope = (await pool.query(`
    select project.organization_id, project.id as project_id,
           membership.user_id as customer_user_id
      from ss.projects project
      join ss.organization_memberships membership
        on membership.organization_id = project.organization_id
       and membership.state = 'active'
       and membership.role in ('owner','admin','billing')
     where project.lifecycle = 'active'
     order by project.created_at, project.id, membership.user_id
     limit 1
  `)).rows[0];
  assert.ok(scope, "Responder commerce proof requires one active customer project");

  const operatorId = randomUUID();
  const authorizerId = randomUUID();
  await pool.query(
    `insert into auth.users (id, email) values ($1, $2), ($3, $4)`,
    [
      operatorId, `responder-commerce-operator-${operatorId}@example.test`,
      authorizerId, `responder-commerce-authorizer-${authorizerId}@example.test`
    ]
  );
  await pool.query(
    `insert into ss.hosted_account_profiles (user_id, display_name, state)
     values ($1, 'Responder Commerce Operator', 'active')`,
    [operatorId]
  );
  await pool.query(
    `insert into ss.operator_profiles (
       user_id, display_label, state, authorized_by_user_id, authorized_at
     ) values ($1, 'Responder Commerce Operator', 'held', $2, clock_timestamp())`,
    [operatorId, authorizerId]
  );
  for (const capability of [
    "service_invoice_manage",
    "service_management_manage"
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
         clock_timestamp(), clock_timestamp() + interval '1 day',
         clock_timestamp())`,
      [operatorId, capability]
    );
  }

  const privileges = await pool.query(`
    select
      has_table_privilege(
        'service_role','ss.responder_commerce_quotes','select,insert'
      ) and not has_table_privilege(
        'service_role','ss.responder_commerce_quotes','update,delete'
      ) as quotes_minimal,
      has_table_privilege(
        'service_role','ss.responder_commerce_reservations','select,insert,update'
      ) and not has_table_privilege(
        'service_role','ss.responder_commerce_reservations','delete'
      ) as reservations_minimal,
      has_table_privilege(
        'service_role','ss.responder_commerce_reservation_events','select,insert'
      ) and not has_table_privilege(
        'service_role','ss.responder_commerce_reservation_events','update,delete'
      ) as events_minimal,
      not has_table_privilege(
        'authenticated','ss.responder_commerce_quotes','select,insert,update,delete'
      ) and not has_table_privilege(
        'authenticated','ss.responder_commerce_reservations',
        'select,insert,update,delete'
      ) as customer_tables_denied
  `);
  for (const [name, value] of Object.entries(privileges.rows[0])) {
    assert.equal(value, true, `Responder commerce privilege failed: ${name}`);
  }

  const observedAt = (await pool.query(
    "select clock_timestamp() as observed_at"
  )).rows[0].observed_at.toISOString();
  const quoteIds = [randomUUID(), randomUUID(), randomUUID()];
  const reservationIds = [randomUUID(), randomUUID(), randomUUID()];
  const authority = createCanonicalPostgresAuthority({ pool });
  const repository = createPostgresResponderCommerceRepository({ authority });
  const service = createHeldResponderCommerceService({
    repository,
    ids: {
      next(kind) {
        const selected = kind === "responder_quote"
          ? quoteIds
          : reservationIds;
        assert.ok(selected.length > 0, `unexpected exhausted ${kind} IDs`);
        return selected.shift();
      }
    },
    clock: { now: () => observedAt }
  });
  const actor = {
    userId: operatorId,
    organizationId: scope.organization_id
  };
  const operatorScope = {
    organizationId: scope.organization_id,
    projectId: scope.project_id,
    customerUserId: scope.customer_user_id
  };
  const readiness = await service.readiness();
  assert.equal(readiness.ready, true, JSON.stringify(readiness));
  assert.equal(readiness.durableCommercialState, true);
  assert.equal(readiness.catalogAuthorityVerified, true);
  assert.equal(readiness.sellable, false);
  assert.equal(readiness.providerEffects, false);
  passed("readiness-durable-catalog-held");

  const http = createResponderCommerceHttpBoundary({
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
    `https://app.sitesourcery.test/api/v1/responder/projects/${scope.project_id}` +
    "/commerce";
  const operatorBase =
    "https://app.sitesourcery.test/api/v1/operator/responder/organizations/" +
    `${scope.organization_id}/projects/${scope.project_id}/customers/` +
    `${scope.customer_user_id}/commerce`;
  const operatorCatalog = await http.dispatch(
    new Request(`${operatorBase}/catalog`)
  );
  assert.equal(operatorCatalog.status, 200);
  assert.equal((await operatorCatalog.json()).catalog.prices.setup.amountMinor, 30_000);
  await expectCode(
    () => http.dispatch(new Request(
      "https://app.sitesourcery.test/api/v1/operator/responder/organizations/" +
      `${randomUUID()}/projects/${scope.project_id}/customers/` +
      `${scope.customer_user_id}/commerce/catalog`
    )),
    "RESPONDER_COMMERCE_UNAVAILABLE"
  );
  passed("http-operator-and-cross-org-boundary");

  const quoteInput = {
    ...operatorScope,
    commandId: "responder.commerce.pg.quote.0001"
  };
  const quote = await service.createHeldQuote(actor, quoteInput);
  assert.deepEqual(await service.createHeldQuote(actor, quoteInput), quote);
  assert.equal(quote.payable, false);
  assert.equal(quote.billing.setupAmountMinor, 30_000);
  assert.equal(quote.billing.monthlyAmountMinor, 25_000);
  assert.equal(quote.tax.state, "disabled_by_owner");
  passed("quote-exact-and-replay-safe");

  const reservationInput = {
    ...operatorScope,
    commandId: "responder.commerce.pg.reserve.0001",
    quoteId: quote.quoteId,
    acceptedQuoteDigest: quote.quoteDigest
  };
  await expectCode(
    () => service.reserveHeldBilling(actor, {
      ...reservationInput,
      commandId: quoteInput.commandId
    }),
    "RESPONDER_COMMERCE_IDEMPOTENCY_CONFLICT"
  );
  passed("command-fingerprint-drift-denied");
  const reservation = await service.reserveHeldBilling(actor, reservationInput);
  assert.deepEqual(
    await service.reserveHeldBilling(actor, reservationInput),
    reservation
  );
  assert.equal(reservation.providerRequest, null);
  assert.equal(reservation.providerEffects, false);
  const customerQuote = await http.dispatch(
    new Request(`${customerBase}/quotes/${quote.quoteId}`)
  );
  const customerReservation = await http.dispatch(
    new Request(`${customerBase}/reservations/${reservation.reservationId}`)
  );
  assert.equal(customerQuote.status, 200);
  assert.equal(customerReservation.status, 200);
  assert.equal("actorId" in await customerQuote.json(), false);
  assert.equal("actorId" in await customerReservation.json(), false);
  passed("reservation-replay-and-customer-readback");

  await expectCode(
    () => service.reserveHeldBilling(actor, {
      ...reservationInput,
      commandId: "responder.commerce.pg.reserve.overlap.0001"
    }),
    "RESPONDER_COMMERCE_RESERVATION_OVERLAP"
  );
  passed("one-per-quote-overlap-denied");

  const cancellationInput = {
    ...operatorScope,
    commandId: "responder.commerce.pg.cancel.0001",
    reservationId: reservation.reservationId,
    expectedRevision: 1,
    cancellationEvidenceDigest: "c".repeat(64)
  };
  const cancelled = await service.cancelHeldReservation(actor, cancellationInput);
  assert.deepEqual(
    await service.cancelHeldReservation(actor, cancellationInput),
    cancelled
  );
  assert.equal(cancelled.state, "cancelled");
  await expectCode(
    () => service.requestReversal(actor, {
      ...operatorScope,
      reservationId: reservation.reservationId
    }),
    "RESPONDER_COMMERCE_REVERSAL_HELD"
  );
  await expectCode(
    () => service.requestReversal(
      { userId: operatorId, organizationId: randomUUID() },
      {
        ...operatorScope,
        organizationId: randomUUID(),
        reservationId: reservation.reservationId
      }
    ),
    "RESPONDER_COMMERCE_UNAVAILABLE"
  );
  passed("cancellation-replay-and-reversal-held");

  const concurrentQuoteInput = {
    ...operatorScope,
    commandId: "responder.commerce.pg.quote.0002"
  };
  const concurrentQuoteResults = await Promise.allSettled([
    service.createHeldQuote(actor, concurrentQuoteInput),
    service.createHeldQuote(actor, concurrentQuoteInput)
  ]);
  const fulfilledQuoteCount = concurrentQuoteResults.filter(
    ({ status }) => status === "fulfilled"
  ).length;
  const rejectedQuoteCount = concurrentQuoteResults.filter(
    ({ status }) => status === "rejected"
  ).length;
  assert.ok([1, 2].includes(fulfilledQuoteCount));
  assert.equal(fulfilledQuoteCount + rejectedQuoteCount, 2);
  const rejectedQuote = concurrentQuoteResults.find(
    ({ status }) => status === "rejected"
  );
  if (rejectedQuote) {
    assert.equal(rejectedQuote.reason?.code, "RESPONDER_COMMERCE_RETRY_REQUIRED");
  }
  const secondQuote = await service.createHeldQuote(actor, concurrentQuoteInput);
  passed("concurrent-create-fenced-to-replay");
  const secondReservation = await service.reserveHeldBilling(actor, {
    ...operatorScope,
    commandId: "responder.commerce.pg.reserve.0002",
    quoteId: secondQuote.quoteId,
    acceptedQuoteDigest: secondQuote.quoteDigest
  });
  const ambiguityInput = {
    ...operatorScope,
    commandId: "responder.commerce.pg.ambiguity.0001",
    reservationId: secondReservation.reservationId,
    expectedRevision: 1,
    ambiguityEvidenceDigest: "a".repeat(64)
  };
  const ambiguous = await service.markReservationAmbiguous(actor, ambiguityInput);
  assert.deepEqual(
    await service.markReservationAmbiguous(actor, ambiguityInput),
    ambiguous
  );
  assert.equal(ambiguous.state, "ambiguity_review_required");
  assert.equal(ambiguous.providerEffectCertainty, "ambiguous");
  passed("ambiguity-replay-fails-closed");

  let crossOrgError = null;
  try {
    await authority.service({
      actorKind: "operator",
      userId: operatorId,
      organizationId: randomUUID(),
      isolation: "serializable"
    }, (client) => client.query(
      `insert into ss.responder_commerce_commands (
         id,organization_id,project_id,customer_user_id,command_id,operation,
         resource_kind,resource_id,actor_user_id,request_digest,result_digest,
         recorded_at,created_at
       ) values ($1,$2,$3,$4,'responder.commerce.pg.cross-org.0001',
         'responder_quote_create','quote',$5,$6,$7,$8,
         clock_timestamp(),clock_timestamp())`,
      [
        randomUUID(), scope.organization_id, scope.project_id,
        scope.customer_user_id, randomUUID(), operatorId,
        "e".repeat(64), "f".repeat(64)
      ]
    ));
  } catch (error) {
    crossOrgError = error;
  }
  assert.equal(crossOrgError?.code, "42501");
  passed("database-cross-org-denied");

  const strippedDocumentDigest = (await pool.query(
    "select ss.project_legal_json_digest('{}'::jsonb) as digest"
  )).rows[0].digest;
  let strippedQuoteError = null;
  try {
    await authority.service({
      actorKind: "operator",
      userId: operatorId,
      organizationId: scope.organization_id,
      isolation: "serializable"
    }, async (client) => {
      const attackQuoteId = randomUUID();
      const attackCommandId = "responder.commerce.pg.stripped-quote.0001";
      await client.query(
        `insert into ss.responder_commerce_commands (
           id,organization_id,project_id,customer_user_id,command_id,operation,
           resource_kind,resource_id,actor_user_id,request_digest,result_digest,
           recorded_at,created_at
         ) values ($1,$2,$3,$4,$5,'responder_quote_create','quote',$6,$7,$8,$9,
           $10,$10)`,
        [
          randomUUID(), scope.organization_id, scope.project_id,
          scope.customer_user_id, attackCommandId, attackQuoteId, operatorId,
          "1".repeat(64), strippedDocumentDigest, observedAt
        ]
      );
      await client.query(
        `insert into ss.responder_commerce_quotes (
           id,organization_id,project_id,customer_user_id,catalog_id,
           actor_user_id,command_id,catalog_version,source_authority_digest,
           catalog_digest,eligibility_digest,state,setup_amount_minor,
           monthly_amount_minor,initial_subtotal_minor,currency,
           recurring_cadence,tax_state,tax_minor,initial_total_minor,payable,
           dispatch_authorized,customer_acceptance_authorized,
           customer_effects_authorized,mail_delivery_effects_authorized,
           payment_effects_authorized,provider_effects_authorized,issued_at,
           expires_at,disclosure_digest,quote_digest,quote_document
         ) values ($1,$2,$3,$4,'00000000-0000-4000-8000-000000001351',$5,$6,
           'SS-RESPONDER-COMMERCE-2026.1',
           'b62255bdcea5f04882ac1b6bbb415069410c915858bb6a4b26fb3598fa28613c',
           '49961dfa89ca4780aa7c5cfc55728ba7c0eddb2851eb73c400d847184e6f8424',
           $7,'held',30000,25000,55000,'USD','month','disabled_by_owner',0,
           55000,false,false,false,false,false,false,false,$8,
           $8::timestamptz + interval '1 day',$9,$10,'{}'::jsonb)`,
        [
          attackQuoteId, scope.organization_id, scope.project_id,
          scope.customer_user_id, operatorId, attackCommandId,
          quote.eligibilityDigest, observedAt, "2".repeat(64),
          strippedDocumentDigest
        ]
      );
    });
  } catch (error) {
    strippedQuoteError = error;
  }
  assert.equal(strippedQuoteError?.code, "23514");

  let strippedReservationError = null;
  try {
    await authority.service({
      actorKind: "operator",
      userId: operatorId,
      organizationId: scope.organization_id,
      isolation: "serializable"
    }, async (client) => {
      const attackReservationId = randomUUID();
      const attackCommandId =
        "responder.commerce.pg.stripped-reservation.0001";
      await client.query(
        `insert into ss.responder_commerce_commands (
           id,organization_id,project_id,customer_user_id,command_id,operation,
           resource_kind,resource_id,actor_user_id,request_digest,result_digest,
           recorded_at,created_at
         ) values ($1,$2,$3,$4,$5,'responder_billing_reserve',
           'billing_reservation',$6,$7,$8,$9,$10,$10)`,
        [
          randomUUID(), scope.organization_id, scope.project_id,
          scope.customer_user_id, attackCommandId, attackReservationId,
          operatorId, "3".repeat(64), strippedDocumentDigest, observedAt
        ]
      );
      await client.query(
        `insert into ss.responder_commerce_reservations (
           id,organization_id,project_id,customer_user_id,quote_id,
           actor_user_id,opening_command_id,latest_command_id,quote_digest,
           eligibility_digest,state,revision,reservation_kind,intended_provider,
           provider_request,provider_effect_certainty,hold_reason,
           dispatch_authorized,customer_acceptance_authorized,
           setup_amount_minor,monthly_amount_minor,initial_subtotal_minor,
           tax_state,tax_minor,initial_total_minor,currency,
           cancellation_evidence_digest,ambiguity_evidence_digest,
           customer_effects_authorized,mail_delivery_effects_authorized,
           payment_effects_authorized,provider_effects_authorized,reserved_at,
           updated_at,reservation_digest,reservation_document
         ) values ($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,'held',1,
           'responder_setup_and_monthly','stripe',null,'not_submitted',
           'responder_catalog_legal_provider_release_required',false,false,
           30000,25000,55000,'disabled_by_owner',0,55000,'USD',null,null,
           false,false,false,false,$10,$10,$11,'{}'::jsonb)`,
        [
          attackReservationId, scope.organization_id, scope.project_id,
          scope.customer_user_id, secondQuote.quoteId, operatorId,
          attackCommandId, secondQuote.quoteDigest,
          secondQuote.eligibilityDigest, observedAt, strippedDocumentDigest
        ]
      );
    });
  } catch (error) {
    strippedReservationError = error;
  }
  assert.equal(strippedReservationError?.code, "23514");
  passed("stripped-self-digested-documents-denied");

  let mutationError = null;
  try {
    await authority.service({
      actorKind: "operator",
      userId: operatorId,
      organizationId: scope.organization_id,
      isolation: "serializable"
    }, (client) => client.query(
      `update ss.responder_commerce_quotes set state='held'
        where organization_id=$1 and id=$2`,
      [scope.organization_id, quote.quoteId]
    ));
  } catch (error) {
    mutationError = error;
  }
  assert.ok(["23514", "42501", "55000"].includes(mutationError?.code));
  passed("append-only-quote-evidence");

  const exact = await pool.query(`
    select
      (select count(*) from ss.responder_commerce_quotes
        where organization_id=$1)=2 as quotes_exact,
      (select count(*) from ss.responder_commerce_reservations
        where organization_id=$1)=2 as reservations_exact,
      (select count(*) from ss.responder_commerce_reservation_events
        where organization_id=$1)=4 as events_exact,
      (select count(*) from ss.responder_commerce_commands
        where organization_id=$1)=6 as commands_exact,
      (select bool_and(not customer_effects_authorized
        and not mail_delivery_effects_authorized
        and not payment_effects_authorized
        and not provider_effects_authorized)
       from ss.responder_commerce_reservations
       where organization_id=$1) as all_effects_held,
      (select bool_and(c.relrowsecurity and c.relforcerowsecurity)
       from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='ss' and c.relname=any($2::text[])) as forced_rls
  `, [scope.organization_id, [
    "responder_commerce_catalog",
    "responder_commerce_commands",
    "responder_commerce_quotes",
    "responder_commerce_reservations",
    "responder_commerce_reservation_events"
  ]]);
  for (const [name, value] of Object.entries(exact.rows[0])) {
    assert.equal(value, true, `Responder commerce exact proof failed: ${name}`);
  }
  passed("exact-held-state-and-forced-rls");

  await pool.query("begin");
  try {
    await pool.query(
      `insert into ss.deletion_requests (
         id,organization_id,project_id,requested_by_user_id,policy_version,
         state,sealed_at,accepted_term_ids,billing_timestamps,
         address_disposition,retained_customer_domains,removal_counts
       ) values ($1,$2,$3,null,'responder-commerce-terminal-proof/v1',
         'purging',clock_timestamp(),'{}'::uuid[],'{}'::jsonb,'no_address',
         '{}'::text[],'{}'::jsonb)`,
      [randomUUID(), scope.organization_id, scope.project_id]
    );
    await pool.query(
      `update ss.projects set lifecycle='deleting',name=null,
         deletion_started_at=coalesce(deletion_started_at,clock_timestamp()),
         revision=revision+1 where organization_id=$1 and id=$2`,
      [scope.organization_id, scope.project_id]
    );
    const cleanup = await pool.query(`
      select
        (select count(*) from ss.responder_commerce_quotes
          where organization_id=$1 and project_id=$2)=0 as quotes_removed,
        (select count(*) from ss.responder_commerce_reservations
          where organization_id=$1 and project_id=$2)=0 as reservations_removed,
        (select count(*) from ss.responder_commerce_reservation_events
          where organization_id=$1 and project_id=$2)=0 as events_removed,
        (select count(*) from ss.responder_commerce_commands
          where organization_id=$1 and project_id=$2)=0 as commands_removed,
        (select removal_counts @> jsonb_build_object(
          'responderCommerceCommands',6,
          'responderCommerceQuotes',2,
          'responderCommerceReservations',2,
          'responderCommerceReservationEvents',4)
         from ss.deletion_requests where project_id=$2) as counts_sealed
    `, [scope.organization_id, scope.project_id]);
    for (const [name, value] of Object.entries(cleanup.rows[0])) {
      assert.equal(value, true, `Responder cleanup proof failed: ${name}`);
    }
  } finally {
    await pool.query("rollback");
  }
  passed("terminal-cleanup-sealed-and-rollback-proven");

  assert.deepEqual(gates, [
    "readiness-durable-catalog-held",
    "http-operator-and-cross-org-boundary",
    "quote-exact-and-replay-safe",
    "command-fingerprint-drift-denied",
    "reservation-replay-and-customer-readback",
    "one-per-quote-overlap-denied",
    "cancellation-replay-and-reversal-held",
    "concurrent-create-fenced-to-replay",
    "ambiguity-replay-fails-closed",
    "database-cross-org-denied",
    "stripped-self-digested-documents-denied",
    "append-only-quote-evidence",
    "exact-held-state-and-forced-rls",
    "terminal-cleanup-sealed-and-rollback-proven"
  ]);
  return Object.freeze({
    assertions: gates.length,
    quotes: 2,
    reservations: 2,
    reservationEvents: 4,
    commands: 6,
    providerEffects: false,
    paymentEffects: false,
    customerEffects: false
  });
}
