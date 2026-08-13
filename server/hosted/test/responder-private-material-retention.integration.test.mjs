import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import pg from "pg";

import {
  createFakeResponderProvider,
  createResponderCore
} from "../responder-core.mjs";
import { createPostgresResponderCoreRepository } from
  "../responder-core-postgres.mjs";
import { createPostgresResponderPrivateMaterialResolver } from
  "../responder-private-material-postgres.mjs";
import { createResponderPrivateMaterialVault } from
  "../responder-private-material-vault.mjs";
import {
  createPostgresResponderPrivateMaterialRetentionRepository
} from "../responder-private-material-retention-postgres.mjs";
import { createCanonicalPostgresAuthority } from "../repository-postgres.mjs";
import { digest } from "../security.mjs";

const DATABASE_URL =
  process.env.SITESOURCERY_PG_RESPONDER_RETENTION_TEST_URL;
const { Pool } = pg;
const BODY =
  "Sorry we missed you - this is Site Sourcery. Reply STOP to opt out.";
const CONTENT_DIGEST = digest({ contentKind: "sms", body: BODY });
const WORKER = "responder-retention-pg-journey-0001";
const OTHER_WORKER = "responder-retention-pg-journey-0002";

async function seed(pool, label) {
  const ids = {
    authorizer: randomUUID(),
    billing: randomUUID(),
    customer: randomUUID(),
    operator: randomUUID(),
    organization: randomUUID(),
    project: randomUUID()
  };
  await pool.query(
    `insert into auth.users (id, email) values ($1,$2),($3,$4),($5,$6)`,
    [
      ids.customer, `${label}-customer-${ids.customer}@example.test`,
      ids.operator, `${label}-operator-${ids.operator}@example.test`,
      ids.authorizer, `${label}-authorizer-${ids.authorizer}@example.test`
    ]
  );
  await pool.query(
    `insert into ss.billing_policies (
       id, policy_key, grace_period, retention_period, effective_at
     ) values ($1,$2, interval '14 days', interval '90 days', clock_timestamp())`,
    [ids.billing, `${label}-${ids.billing}`]
  );
  await pool.query(
    `insert into ss.organizations (id, created_by_user_id, name)
     values ($1,$2,$3)`,
    [ids.organization, ids.customer, `Retention ${label}`]
  );
  await pool.query(
    `insert into ss.organization_memberships (
       organization_id, user_id, role, state, accepted_at
     ) values ($1,$2,'owner','active',clock_timestamp()),
              ($1,$3,'owner','active',clock_timestamp())`,
    [ids.organization, ids.customer, ids.operator]
  );
  await pool.query(
    `insert into ss.projects (
       id, organization_id, created_by_user_id, billing_policy_id, name
     ) values ($1,$2,$3,$4,$5)`,
    [ids.project, ids.organization, ids.customer, ids.billing, `${label} Project`]
  );
  await pool.query(
    `insert into ss.hosted_account_profiles (user_id, display_name, state)
     values ($1,$2,'active'),($3,$4,'active')`,
    [ids.operator, `${label} Operator`, ids.authorizer, `${label} Authorizer`]
  );
  await pool.query(
    `insert into ss.operator_profiles (
       user_id, display_label, state, authorized_by_user_id, authorized_at
     ) values ($1,$2,'held',$3,clock_timestamp())`,
    [ids.operator, `${label} Operator`, ids.authorizer]
  );
  await pool.query(
    `insert into ss.operator_permissions (
       operator_user_id, capability, state, granted_by_user_id, granted_at
     ) values ($1,'service_management_manage','held',$2,clock_timestamp())`,
    [ids.operator, ids.authorizer]
  );
  await pool.query(
    `insert into ss.service_operator_authority_events (
       operator_user_id, capability, event_sequence, event_kind,
       predecessor_event_id, recorded_by_kind, effective_at, expires_at,
       created_at
     ) values ($1,'service_management_manage',1,'grant',null,
       'deployment_control',clock_timestamp(),
       clock_timestamp()+interval '1 day',clock_timestamp())`,
    [ids.operator]
  );
  return ids;
}

test("Responder private material holds, zeroing, replay, recovery, tenancy, and backup horizon hold on real PostgreSQL", {
  skip: !DATABASE_URL
}, async () => {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 4 });
  try {
    const ids = await seed(pool, `ret-${randomUUID().slice(0, 8)}`);
    const other = await seed(pool, `other-${randomUUID().slice(0, 8)}`);
    let selectedNow = new Date().toISOString();
    const tick = (milliseconds = 25) => {
      selectedNow = new Date(
        Date.parse(selectedNow) + milliseconds
      ).toISOString();
      return selectedNow;
    };
    const authority = createCanonicalPostgresAuthority({ pool });
    const core = createResponderCore({
      repository: createPostgresResponderCoreRepository({ authority }),
      provider: createFakeResponderProvider(),
      clock: { now: () => selectedNow }
    });
    const vault = createResponderPrivateMaterialVault({
      currentKeyVersion: "retention-pg-2026-08",
      currentKey: Buffer.alloc(32, 7)
    });
    const resolver = createPostgresResponderPrivateMaterialResolver({
      authority,
      vault
    });
    const retention =
      createPostgresResponderPrivateMaterialRetentionRepository({ authority });
    const customer = {
      kind: "customer",
      userId: ids.customer,
      organizationId: ids.organization
    };
    const routeDigest = digest({
      routeKind: "sms",
      address: "+18565550100"
    });
    const suffix = randomUUID().slice(0, 8);

    assert.equal((await retention.readiness()).ready, true);

    tick();
    const consent = await core.recordConsent(customer, {
      commandId: `ret-${suffix}-consent`,
      organizationId: ids.organization,
      projectId: ids.project,
      customerUserId: ids.customer,
      routeDigest,
      consentBasis: "inbound_call",
      consentEvidenceDigest: digest(`ret-${suffix}-consent-evidence`),
      consentedAt: selectedNow
    });
    tick();
    const missed = await core.ingestProviderEvent({
      commandId: `ret-${suffix}-missed`,
      organizationId: ids.organization,
      projectId: ids.project,
      providerEventIdDigest: digest(`ret-${suffix}-missed-id`),
      routeDigest,
      eventKind: "missed_call",
      payloadDigest: digest(`ret-${suffix}-missed-payload`),
      occurredAt: selectedNow
    });
    tick();
    await core.reserveHeldMessage(customer, {
      commandId: `ret-${suffix}-ack`,
      organizationId: ids.organization,
      projectId: ids.project,
      interactionId: missed.interactionId,
      contactAuthorityId: consent.id,
      messageKind: "missed_call_ack",
      contentDigest: CONTENT_DIGEST
    });
    const operationResult = await pool.query(
      `select * from ss.responder_delivery_operations where command_id = $1`,
      [`ret-${suffix}-ack`]
    );
    const operation = operationResult.rows[0];
    tick();
    await resolver.storeSmsMaterial({
      operationId: operation.id,
      organizationId: ids.organization,
      projectId: ids.project,
      interactionId: operation.interaction_id,
      contactAuthorityId: operation.contact_authority_id,
      messageKind: "missed_call_ack",
      routeDigest,
      contentDigest: CONTENT_DIGEST,
      to: "+18565550100",
      body: BODY,
      recordedAt: selectedNow
    });

    // Legal hold placement is operator-bound, replay-safe, and blocks even
    // after the contact opts out and lifecycle eligibility becomes true.
    const legalHoldId = randomUUID();
    tick();
    const legalHold = {
      holdId: legalHoldId,
      organizationId: ids.organization,
      projectId: ids.project,
      scopeKind: "project",
      subjectId: ids.project,
      holdKind: "legal",
      evidenceDigest: digest(`ret-${suffix}-legal-hold`),
      holdUntil: null,
      operatorUserId: ids.operator,
      placedAt: selectedNow
    };
    assert.equal((await retention.placeHold(legalHold)).replayed, false);
    assert.equal((await retention.placeHold(legalHold)).replayed, true);

    tick();
    await core.recordStop(customer, {
      commandId: `ret-${suffix}-stop`,
      contactAuthorityId: consent.id,
      occurredAt: selectedNow,
      organizationId: ids.organization,
      payloadDigest: digest(`ret-${suffix}-stop-payload`),
      projectId: ids.project,
      providerEventIdDigest: digest(`ret-${suffix}-stop-id`),
      routeDigest
    });
    tick();
    assert.equal((await retention.discoverEligible({
      workerId: WORKER,
      observedAt: selectedNow,
      limit: 20
    })).discovered, 0);
    assert.equal(await retention.claimNext({
      workerId: WORKER,
      observedAt: tick(),
      leaseSeconds: 120
    }), null);

    await assert.rejects(
      retention.placeHold({
        ...legalHold,
        holdId: randomUUID(),
        organizationId: other.organization,
        projectId: other.project,
        scopeKind: "delivery_material",
        subjectId: operation.id,
        operatorUserId: other.operator,
        placedAt: tick()
      }),
      (error) => error?.code === "RESPONDER_RETENTION_CONFLICT",
      "another tenant cannot hold or discover this material"
    );

    const release = {
      holdId: legalHoldId,
      organizationId: ids.organization,
      operatorUserId: ids.operator,
      releaseEvidenceDigest: digest(`ret-${suffix}-legal-release`),
      releasedAt: tick()
    };
    assert.equal((await retention.releaseHold(release)).replayed, false);
    assert.equal((await retention.releaseHold(release)).replayed, true);
    assert.equal((await retention.discoverEligible({
      workerId: WORKER,
      observedAt: tick(),
      limit: 20
    })).discovered, 1);
    const outboundClaim = await retention.claimNext({
      workerId: WORKER,
      observedAt: tick(),
      leaseSeconds: 120
    });
    assert.equal(outboundClaim.materialKind, "delivery_material");
    await assert.rejects(
      retention.destroyClaim({
        jobId: outboundClaim.jobId,
        workerId: OTHER_WORKER,
        observedAt: tick()
      }),
      (error) => error?.code === "RESPONDER_RETENTION_LEASE_LOST"
    );
    const destroyedOutbound = await retention.destroyClaim({
      jobId: outboundClaim.jobId,
      workerId: WORKER,
      observedAt: tick()
    });
    assert.equal(destroyedOutbound.primaryCiphertextZeroed, true);
    assert.equal(destroyedOutbound.destroyReason, "opt_out");
    assert.equal(
      Date.parse(destroyedOutbound.backupRetentionUntil) -
        Date.parse(destroyedOutbound.destroyedAt),
      30 * 24 * 60 * 60 * 1000
    );
    assert.equal((await retention.destroyClaim({
      jobId: outboundClaim.jobId,
      workerId: WORKER,
      observedAt: tick()
    })).replayed, true);
    const zeroedOutbound = await pool.query(
      `select state, key_version, nonce, authentication_tag, ciphertext,
              envelope_digest, destroy_reason
         from ss.responder_private_delivery_materials
        where operation_id = $1`,
      [operation.id]
    );
    assert.deepEqual(zeroedOutbound.rows[0], {
      state: "destroyed",
      key_version: "retention-pg-2026-08",
      nonce: null,
      authentication_tag: null,
      ciphertext: null,
      envelope_digest: outboundClaim.sourceEnvelopeDigest,
      destroy_reason: "opt_out"
    });

    // Build one old inbound ciphertext row. It becomes retention-eligible,
    // then a hold races after its claim. Destruction fails, the lease is
    // released, and the same job resumes safely after named release.
    tick();
    const inboundCore = await core.ingestProviderEvent({
      commandId: `ret-${suffix}-inbound-core`,
      organizationId: ids.organization,
      projectId: ids.project,
      providerEventIdDigest: digest(`ret-${suffix}-inbound-core-id`),
      routeDigest: digest({ routeKind: "sms", address: "+18565550101" }),
      eventKind: "message_received",
      payloadDigest: digest(`ret-${suffix}-inbound-core-payload`),
      occurredAt: selectedNow
    });
    const coreEvent = await pool.query(
      `select id from ss.responder_provider_events where command_id = $1`,
      [`ret-${suffix}-inbound-core`]
    );
    const inboundId = randomUUID();
    const inboundPayloadDigest = digest(`ret-${suffix}-inbound-payload`);
    const inboundFromDigest = digest(`ret-${suffix}-inbound-from`);
    const oldTime = new Date(
      Date.parse(selectedNow) - 31 * 24 * 60 * 60 * 1000
    ).toISOString();
    await authority.service({
      actorKind: "system",
      organizationId: ids.organization,
      isolation: "serializable"
    }, async (client) => {
      await client.query(`
        insert into ss.responder_twilio_inbound_events (
          id, provider, channel, event_kind, provider_event_digest,
          provider_event_id_digest, account_sid_digest,
          messaging_service_sid_digest, to_number_lookup_digest,
          to_number_key_version, from_route_digest, from_route_key_version,
          dial_call_status, opt_out_type, classified_intent,
          signature_verification_digest, payload_digest, state, state_reason,
          organization_id, project_id, core_provider_event_id,
          received_at, created_at
        ) values (
          $1,'twilio','voice','dial_result',$2,$3,$4,null,$5,'ret-v1',
          $6,'ret-v1','no-answer',null,'not_applicable',$7,$2,
          'applied',null,$8,$9,$10,$11,$11
        )`,
        [
          inboundId, inboundPayloadDigest, digest(`ret-${suffix}-inbound-sid`),
          digest(`ret-${suffix}-account`), digest(`ret-${suffix}-to`),
          inboundFromDigest, digest(`ret-${suffix}-signature`),
          ids.organization, ids.project, coreEvent.rows[0].id, oldTime
        ]
      );
      await client.query(`
        insert into ss.responder_inbound_private_materials (
          inbound_event_id, organization_id, project_id, channel,
          from_route_digest, payload_digest, key_version, nonce,
          authentication_tag, ciphertext, envelope_digest, state,
          created_at, updated_at
        ) values (
          $1,$2,$3,'voice',$4,$5,'inbound-retention-pg',
          decode(repeat('01',12),'hex'), decode(repeat('02',16),'hex'),
          decode(repeat('03',32),'hex'),
          ss.responder_inbound_material_envelope_digest(
            $1,$2,$3,'voice',$4,$5,'inbound-retention-pg',
            decode(repeat('01',12),'hex'), decode(repeat('02',16),'hex'),
            decode(repeat('03',32),'hex')
          ), 'active', $6, $6
        )`,
        [
          inboundId, ids.organization, ids.project, inboundFromDigest,
          inboundPayloadDigest, oldTime
        ]
      );
    });
    assert.equal(inboundCore.interactionId.length, 36);
    assert.equal((await retention.discoverEligible({
      workerId: WORKER,
      observedAt: tick(),
      limit: 20
    })).discovered, 1);
    const inboundClaim = await retention.claimNext({
      workerId: WORKER,
      observedAt: tick(),
      leaseSeconds: 120
    });
    assert.equal(inboundClaim.materialKind, "inbound_material");

    const racedHoldId = randomUUID();
    const racedHold = {
      holdId: racedHoldId,
      organizationId: ids.organization,
      projectId: ids.project,
      scopeKind: "inbound_material",
      subjectId: inboundId,
      holdKind: "retention",
      evidenceDigest: digest(`ret-${suffix}-raced-hold`),
      holdUntil: new Date(Date.parse(selectedNow) + 60_000).toISOString(),
      operatorUserId: ids.operator,
      placedAt: tick()
    };
    await retention.placeHold(racedHold);
    await assert.rejects(
      retention.destroyClaim({
        jobId: inboundClaim.jobId,
        workerId: WORKER,
        observedAt: tick()
      }),
      (error) => error?.code === "RESPONDER_RETENTION_HELD"
    );
    assert.equal((await retention.releaseClaim({
      jobId: inboundClaim.jobId,
      workerId: WORKER,
      failureCode: "RESPONDER_RETENTION_HELD",
      observedAt: tick(),
      retryAt: selectedNow
    })).status, "released");
    await retention.releaseHold({
      holdId: racedHoldId,
      organizationId: ids.organization,
      operatorUserId: ids.operator,
      releaseEvidenceDigest: digest(`ret-${suffix}-raced-release`),
      releasedAt: tick()
    });
    const resumedClaim = await retention.claimNext({
      workerId: WORKER,
      observedAt: tick(),
      leaseSeconds: 120
    });
    assert.equal(resumedClaim.jobId, inboundClaim.jobId);
    assert.equal(resumedClaim.attemptCount, 2);
    const destroyedInbound = await retention.destroyClaim({
      jobId: resumedClaim.jobId,
      workerId: WORKER,
      observedAt: tick()
    });
    assert.equal(destroyedInbound.destroyReason, "accepted_retention");
    const zeroedInbound = await pool.query(
      `select state, key_version, nonce, authentication_tag, ciphertext,
              envelope_digest, destroy_reason
         from ss.responder_inbound_private_materials
        where inbound_event_id = $1`,
      [inboundId]
    );
    assert.deepEqual(zeroedInbound.rows[0], {
      state: "destroyed",
      key_version: null,
      nonce: null,
      authentication_tag: null,
      ciphertext: null,
      envelope_digest: null,
      destroy_reason: "accepted_retention"
    });
    const counts = await pool.query(`
      select
        (select count(*)::integer
           from ss.responder_private_material_destruction_receipts
          where organization_id = $1) as receipts,
        (select count(*)::integer
           from ss.responder_private_material_cleanup_jobs
          where organization_id = $1 and state = 'succeeded') as succeeded,
        (select count(*)::integer
           from ss.responder_private_material_cleanup_jobs
          where organization_id = $2) as other_tenant_jobs
    `, [ids.organization, other.organization]);
    assert.deepEqual(counts.rows[0], {
      receipts: 2,
      succeeded: 2,
      other_tenant_jobs: 0
    });
  } finally {
    await pool.end();
  }
});
