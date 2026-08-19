import assert from "node:assert/strict";
import test from "node:test";

import {
  createPostgresNotificationMailDispatchSource
} from "../notification-mail-dispatch-postgres.mjs";

const NOW = "2026-08-11T16:00:00.000Z";
const MESSAGE_ID = "40000000-0000-4000-8000-000000000001";
const SOURCE_ID = "41000000-0000-4000-8000-000000000001";
const WORKER_ID = "mail-worker-00000001";

test("PostgreSQL dispatch source lists only bounded available message identities", async () => {
  const contexts = [];
  const source = createPostgresNotificationMailDispatchSource({
    authority: {
      async service(context, work) {
        contexts.push(context);
        return work({
          async query(sql, values) {
            assert.match(sql, /mail\.expires_at > \$1::timestamptz \+ interval '5 minutes'/u);
            assert.match(sql, /claim\.lease_expires_at > \$1::timestamptz/u);
            assert.deepEqual(values, [NOW, 3]);
            return { rows: [{ id: MESSAGE_ID }] };
          }
        });
      }
    },
    clock: { now: () => NOW }
  });
  assert.deepEqual(await source.listDispatchable({ limit: 3 }), [MESSAGE_ID]);
  assert.deepEqual(contexts, [{ actorKind: "system", readOnly: true }]);
  await assert.rejects(
    source.listDispatchable({ limit: 26 }),
    (error) => error?.code === "NOTIFICATION_DISPATCH_CLAIM_INVALID"
  );
});

test("PostgreSQL dispatch source creates one exact digest-only fenced claim", async () => {
  const contexts = [];
  const authority = {
    async service(context, work) {
      contexts.push(context);
      return work({
        async query(sql, values = []) {
          if (/pg_advisory_xact_lock/u.test(sql)) return { rows: [], rowCount: 1 };
          if (/from ss\.hosted_mail_deliveries mail/u.test(sql)) {
            return {
              rowCount: 1,
              rows: [{
                id: MESSAGE_ID,
                message_type: "support_notification",
                recipient_digest: "1".repeat(64),
                subject_reference_digest: "2".repeat(64),
                content_digest: "3".repeat(64),
                template_version: "support-update.v1",
                state: "pending",
                expires_at: new Date("2026-08-11T17:00:00.000Z"),
                support_reservation_id: SOURCE_ID,
                support_reservation_digest: "4".repeat(64),
                commerce_reservation_id: null,
                commerce_reservation_digest: null,
                purpose_reservation_id: null,
                purpose_reservation_digest: null
              }]
            };
          }
          if (/select \* from ss\.hosted_mail_dispatch_claims/u.test(sql)) {
            return { rows: [], rowCount: 0 };
          }
          if (/insert into ss\.hosted_mail_dispatch_claims/u.test(sql)) {
            assert.equal(values[0], MESSAGE_ID);
            assert.equal(values[1], "support");
            assert.equal(values[2], SOURCE_ID);
            assert.equal(values[5], WORKER_ID);
            return {
              rowCount: 1,
              rows: [{
                worker_id: values[5],
                attempt_number: "1",
                fence_token: "1",
                lease_started_at: new Date(values[6]),
                lease_expires_at: new Date(values[7])
              }]
            };
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        }
      });
    }
  };
  const source = createPostgresNotificationMailDispatchSource({
    authority,
    clock: { now: () => NOW }
  });
  const receipt = await source.claimForDispatch({
    messageId: MESSAGE_ID,
    workerId: WORKER_ID,
    leaseMs: 120_000
  });
  assert.equal(receipt.status, "claimed");
  assert.equal(receipt.sourceKind, "support");
  assert.equal(receipt.attemptNumber, 1);
  assert.equal(receipt.fenceToken, 1);
  assert.equal(
    receipt.providerIdempotencyKey,
    `sitesourcery-notification/${MESSAGE_ID}`
  );
  assert.equal("to" in receipt, false);
  assert.equal("subject" in receipt, false);
  assert.deepEqual(contexts, [{
    actorKind: "system",
    isolation: "serializable"
  }]);
});

test("PostgreSQL dispatch source claims an exact purpose reservation", async () => {
  const source = createPostgresNotificationMailDispatchSource({
    authority: {
      async service(_context, work) {
        return work({
          async query(sql, values = []) {
            if (/pg_advisory_xact_lock/u.test(sql)) return { rows: [], rowCount: 1 };
            if (/from ss[.]hosted_mail_deliveries mail/u.test(sql)) {
              return { rowCount: 1, rows: [{
                id: MESSAGE_ID,
                message_type: "purpose_customer_notification",
                recipient_digest: "1".repeat(64),
                subject_reference_digest: "2".repeat(64),
                content_digest: "3".repeat(64),
                template_version: "domain-lifecycle-updated.v1",
                state: "pending",
                expires_at: new Date("2026-08-11T17:00:00.000Z"),
                support_reservation_id: null,
                support_reservation_digest: null,
                commerce_reservation_id: null,
                commerce_reservation_digest: null,
                purpose_reservation_id: SOURCE_ID,
                purpose_reservation_digest: "4".repeat(64)
              }] };
            }
            if (/select \* from ss[.]hosted_mail_dispatch_claims/u.test(sql)) {
              return { rows: [], rowCount: 0 };
            }
            if (/insert into ss[.]hosted_mail_dispatch_claims/u.test(sql)) {
              assert.equal(values[1], "purpose");
              return { rowCount: 1, rows: [{
                worker_id: values[5],
                attempt_number: "1",
                fence_token: "1",
                lease_started_at: new Date(values[6]),
                lease_expires_at: new Date(values[7])
              }] };
            }
            throw new Error(`Unexpected SQL: ${sql}`);
          }
        });
      }
    },
    clock: { now: () => NOW }
  });
  const receipt = await source.claimForDispatch({
    messageId: MESSAGE_ID,
    workerId: WORKER_ID,
    leaseMs: 120_000
  });
  assert.equal(receipt.sourceKind, "purpose");
  assert.equal(receipt.sourceReservationId, SOURCE_ID);
});

test("PostgreSQL dispatch source readiness is contract and forced-RLS bound", async () => {
  const source = createPostgresNotificationMailDispatchSource({
    authority: {
      async service(context, work) {
        assert.deepEqual(context, { actorKind: "system", readOnly: true });
        return work({
          async query(sql) {
            assert.match(sql, /hosted_mail_dispatch_contract_v2/u);
            assert.match(
              sql,
              /hosted_mail_dispatch_claims_source_kind_check_v140/u
            );
            assert.match(sql, /guard_hosted_mail_dispatch_claim/u);
            assert.match(sql, /rolbypassrls/u);
            assert.match(sql, /aclexplode/u);
            assert.match(sql, /relforcerowsecurity/u);
            return {
              rows: [{
                contract_ready: true,
                table_ready: true,
                rls_ready: true,
                source_constraint_ready: true,
                guard_ready: true,
                acl_ready: true
              }]
            };
          }
        });
      }
    }
  });
  assert.deepEqual(await source.readiness(), {
    ready: true,
    verified: true,
    kind: "notification-mail-dispatch-source-postgres",
    code: null,
    providerEffects: false
  });
});

test("PostgreSQL dispatch source rejects missing authority", () => {
  assert.throws(
    () => createPostgresNotificationMailDispatchSource(),
    (error) =>
      error?.code === "NOTIFICATION_DISPATCH_CLAIM_CONFIGURATION_REQUIRED"
  );
});
