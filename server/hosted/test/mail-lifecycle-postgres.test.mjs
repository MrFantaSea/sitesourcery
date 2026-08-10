import assert from "node:assert/strict";
import test from "node:test";

import {
  createPostgresMailLifecycleRepository
} from "../mail-lifecycle-postgres.mjs";

const ACTOR = "10000000-0000-4000-8000-000000000001";
const ORGANIZATION = "20000000-0000-4000-8000-000000000001";
const NOW = "2026-08-10T14:00:00.000Z";

test("repository readiness proves the v54 marker, all tables, forced RLS, and no provider effects", async () => {
  const repository = createPostgresMailLifecycleRepository({
    authority: {
      async service(context, work) {
        assert.deepEqual(context, { actorKind: "system", readOnly: true });
        return work({
          async query(sql, values) {
            assert.match(sql, /hosted_runtime_contract_v54/u);
            assert.match(
              sql,
              /hosted_identity_delivery_acceptance_contract_v1/u
            );
            assert.equal(values[0].length, 5);
            return {
              rows: [{
                contract_ready: true,
                identity_delivery_ready: true,
                tables_ready: true,
                rls_ready: true
              }]
            };
          }
        });
      }
    }
  });
  assert.deepEqual(await repository.readiness(), {
    ready: true,
    verified: true,
    kind: "durable-mail-lifecycle-postgres",
    code: null,
    providerEffects: false
  });
});

test("owner exception projection is capability-gated and returns no routing digests", async () => {
  const contexts = [];
  const repository = createPostgresMailLifecycleRepository({
    authority: {
      async service(context, work) {
        contexts.push(context);
        let query = 0;
        return work({
          async query(sql) {
            query += 1;
            if (query === 1) {
              assert.match(sql, /service_operator_has_capability/u);
              return { rows: [{ allowed: true }] };
            }
            assert.doesNotMatch(
              sql,
              /recipient_digest|provider_message_id_digest|provider_event_id_digest/u
            );
            return {
              rows: [{
                id: "30000000-0000-4000-8000-000000000001",
                organization_id: null,
                project_id: null,
                message_type: "account_recovery",
                exception_kind: "expired",
                safe_reference_digest: "a".repeat(64),
                opened_at: new Date(NOW),
                revision: "1"
              }]
            };
          }
        });
      }
    }
  });
  const result = await repository.listOwnerExceptions({
    actorId: ACTOR,
    organizationId: ORGANIZATION,
    observedAt: NOW
  });
  assert.deepEqual(contexts, [{
    actorKind: "operator",
    userId: ACTOR,
    organizationId: ORGANIZATION,
    readOnly: true
  }]);
  assert.equal(result.items[0].kind, "expired");
  assert.equal("recipientDigest" in result.items[0], false);
  assert.equal("providerMessageIdDigest" in result.items[0], false);
});

test("repository construction fails closed without canonical authority", () => {
  assert.throws(
    () => createPostgresMailLifecycleRepository(),
    (error) => error.code === "MAIL_LIFECYCLE_CONFIGURATION_REQUIRED"
  );
});
