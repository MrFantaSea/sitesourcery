import assert from "node:assert/strict";
import test from "node:test";

import { createPostgresCommerceTransitionNotificationRepository } from
  "../commerce-transition-notifications-postgres.mjs";

test("commerce notification PostgreSQL repository fails closed without authority", () => {
  assert.throws(
    () => createPostgresCommerceTransitionNotificationRepository(),
    { code: "COMMERCE_NOTIFICATION_CONFIGURATION_REQUIRED" }
  );
});

test("readiness proves held source, MAIL reservation, and forced-RLS contract", async () => {
  const queries = [];
  const repository = createPostgresCommerceTransitionNotificationRepository({
    authority: {
      async service(context, work) {
        queries.push(context);
        return work({
          async query(sql) {
            assert.match(sql, /hosted_commerce_notification_contract_v1/u);
            assert.match(sql, /commerce_transition_notification_outbox/u);
            return {
              rows: [{
                contract_ready: true,
                sources_ready: true,
                rls_ready: true,
                mail_types_ready: true
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
    kind: "commerce-transition-notifications-postgres",
    code: null,
    sourceAuthoritative: true,
    mailReserved: true,
    providerEffects: false,
    deliveryClaimed: false
  });
  assert.deepEqual(queries, [{ actorKind: "system", readOnly: true }]);
});
