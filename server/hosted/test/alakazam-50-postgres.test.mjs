import assert from "node:assert/strict";
import test from "node:test";

import {
  createAlakazam50Configuration
} from "../../commerce-v2/alakazam-50.mjs";
import {
  createPostgresAlakazam50Repository
} from "../alakazam-50-postgres.mjs";

const IDS = {
  tenantId: "10000000-0000-4000-8000-000000000001",
  customerId: "20000000-0000-4000-8000-000000000001",
  projectId: "30000000-0000-4000-8000-000000000001",
  subscriptionId: "40000000-0000-4000-8000-000000000001",
  commandId: "50000000-0000-4000-8000-000000000001"
};
const NOW = "2026-08-09T12:00:00.000Z";

test("readCompilationBinding accepts five-field input while reconstruction receives exact scope", async () => {
  const configuration = createAlakazam50Configuration({
    scope: {
      actorId: IDS.customerId,
      customerId: IDS.customerId,
      projectId: IDS.projectId,
      tenantId: IDS.tenantId
    },
    commandId: IDS.commandId,
    subscription: {
      subscriptionId: IDS.subscriptionId,
      tierId: "alakazam_50",
      status: "active",
      revision: 7
    },
    expectedCurrentRevision: 0,
    cashAppHandle: "cedar.shop",
    venmoHandle: "cedar_shop",
    fontChoiceId: "studio",
    borderChoiceId: "sharp",
    menu: [{ target: "contact", label: "Pay Cedar" }],
    configuredAt: NOW
  });
  const client = {
    async query(sql) {
      if (sql.includes("from ss.alakazam_subscriptions subscription")) {
        return {
          rowCount: 1,
          rows: [{
            id: IDS.subscriptionId,
            tier_id: "alakazam_50",
            status: "active",
            revision: 7
          }]
        };
      }
      if (sql.includes("from ss.alakazam_50_configurations")) {
        return {
          rowCount: 1,
          rows: [{
            id: IDS.commandId,
            subscription_id: IDS.subscriptionId,
            subscription_revision: 7,
            configuration_revision: 1,
            cash_app_handle: "cedar.shop",
            venmo_handle: "cedar_shop",
            font_choice_id: "studio",
            border_choice_id: "sharp",
            menu: [{ target: "contact", label: "Pay Cedar" }],
            configured_at: NOW,
            configuration_digest: configuration.configurationDigest
          }]
        };
      }
      assert.fail(`Unexpected PostgreSQL query: ${sql}`);
    }
  };
  const repository = createPostgresAlakazam50Repository({
    authority: {
      async service(context, work) {
        assert.equal(context.userId, IDS.customerId);
        assert.equal(context.organizationId, IDS.tenantId);
        assert.equal(context.readOnly, true);
        return work(client);
      }
    }
  });
  const binding = await repository.readCompilationBinding({
    actorId: IDS.customerId,
    customerId: IDS.customerId,
    projectId: IDS.projectId,
    tenantId: IDS.tenantId,
    expectedSubscriptionRevision: 7
  });
  assert.equal(binding.configuration.projectId, IDS.projectId);
  assert.equal(
    binding.configuration.configurationDigest,
    configuration.configurationDigest
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      binding.configuration,
      "expectedSubscriptionRevision"
    ),
    false
  );
});
