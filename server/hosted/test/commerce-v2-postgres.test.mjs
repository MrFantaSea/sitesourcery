import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createCommerceV2Boundary,
  createCommerceV2Service,
  createHostedDownloadCommerce
} from "../../commerce-v2/index.mjs";
import {
  createPostgresCommerceV2Adapter
} from "../commerce-v2-postgres.mjs";

const NOW = "2026-07-30T18:00:00.000Z";
const ORGANIZATION_ID =
  "10000000-0000-4000-8000-000000000001";
const USER_ID =
  "20000000-0000-4000-8000-000000000001";
const OTHER_USER_ID =
  "20000000-0000-4000-8000-000000000002";
const PROJECT_ID =
  "30000000-0000-4000-8000-000000000001";
const OTHER_PROJECT_ID =
  "30000000-0000-4000-8000-000000000002";
const VERSION_ID =
  "40000000-0000-4000-8000-000000000001";
const OTHER_VERSION_ID =
  "40000000-0000-4000-8000-000000000002";
const QUOTE_ID =
  "50000000-0000-4000-8000-000000000001";
const CONTENT_DIGEST = "a".repeat(64);

function result(rows = []) {
  return {
    rows: structuredClone(rows),
    rowCount: rows.length
  };
}

function databaseHarness() {
  const commands = new Map();
  const quotes = new Map();
  const preparations = new Map();
  const calls = [];

  const client = {
    async query(text, values = []) {
      calls.push({
        text: text.replace(/\s+/gu, " ").trim(),
        values: structuredClone(values)
      });

      if (
        text.includes("select project.organization_id") &&
        text.includes("membership.role = any")
      ) {
        const [projectId, userId, roles] = values;
        assert.deepEqual(roles, [
          "owner",
          "admin",
          "editor"
        ]);
        return projectId === PROJECT_ID &&
          userId === USER_ID
          ? result([
              { organization_id: ORGANIZATION_ID }
            ])
          : result();
      }

      if (
        text.includes("select project.id") &&
        text.includes("membership.role =")
      ) {
        const [organizationId, userId, projectId] =
          values;
        return organizationId === ORGANIZATION_ID &&
          userId === USER_ID &&
          projectId === PROJECT_ID
          ? result([{ id: PROJECT_ID }])
          : result();
      }

      if (
        text.includes(
          "select fact.content_digest"
        )
      ) {
        const [
          organizationId,
          userId,
          projectId,
          versionId
        ] = values;
        return organizationId === ORGANIZATION_ID &&
          userId === USER_ID &&
          projectId === PROJECT_ID &&
          versionId === VERSION_ID
          ? result([
              {
                content_digest: CONTENT_DIGEST
              }
            ])
          : result();
      }

      if (
        text.includes(
          "insert into ss.commerce_v2_commands"
        )
      ) {
        const [
          organizationId,
          commandId,
          operation,
          fingerprint,
          projectId,
          customerId,
          actorId
        ] = values;
        const key = `${organizationId}:${commandId}`;
        if (commands.has(key)) return result();
        commands.set(key, {
          organizationId,
          commandId,
          operation,
          fingerprint,
          projectId,
          customerId,
          actorId,
          state: "pending",
          result: null
        });
        return result([{ command_id: commandId }]);
      }

      if (
        text.includes(
          "from ss.commerce_v2_commands"
        ) &&
        text.includes("select operation")
      ) {
        const [organizationId, commandId] = values;
        const row = commands.get(
          `${organizationId}:${commandId}`
        );
        return row
          ? result([
              {
                operation: row.operation,
                fingerprint: row.fingerprint,
                state: row.state,
                result: row.result,
                project_id: row.projectId,
                customer_user_id: row.customerId,
                actor_user_id: row.actorId
              }
            ])
          : result();
      }

      if (
        text.includes(
          "insert into ss.commerce_v2_download_quotes"
        )
      ) {
        const snapshot = JSON.parse(values[14]);
        assert.equal(values[0], snapshot.quoteId);
        assert.equal(values[1], ORGANIZATION_ID);
        assert.equal(values[2], "quote-command-1");
        quotes.set(snapshot.quoteId, snapshot);
        return result();
      }

      if (
        text.includes(
          "insert into ss.commerce_v2_checkout_preparations"
        )
      ) {
        const snapshot = JSON.parse(values[11]);
        preparations.set(
          `${values[0]}:${values[1]}`,
          snapshot
        );
        return result();
      }

      if (
        text.includes(
          "update ss.commerce_v2_commands"
        )
      ) {
        const [organizationId, commandId] = values;
        const key = `${organizationId}:${commandId}`;
        const row = commands.get(key);
        if (!row || row.state !== "pending") {
          return result();
        }
        row.state = "complete";
        row.result = JSON.parse(values[2]);
        return result([{ command_id: commandId }]);
      }

      if (
        text.includes(
          "delete from ss.commerce_v2_commands"
        )
      ) {
        const [
          organizationId,
          commandId,
          operation,
          fingerprint,
          projectId,
          customerId,
          actorId
        ] = values;
        const key = `${organizationId}:${commandId}`;
        const row = commands.get(key);
        if (
          row?.state === "pending" &&
          row.operation === operation &&
          row.fingerprint === fingerprint &&
          row.projectId === projectId &&
          row.customerId === customerId &&
          row.actorId === actorId
        ) {
          commands.delete(key);
        }
        return result();
      }

      if (
        text.includes(
          "from ss.commerce_v2_download_quotes"
        ) &&
        text.includes("select snapshot")
      ) {
        const [
          organizationId,
          customerId,
          projectId,
          quoteId
        ] = values;
        const snapshot = quotes.get(quoteId);
        if (
          snapshot?.tenantId !== organizationId ||
          snapshot?.customerId !== customerId ||
          snapshot?.project?.projectId !== projectId
        ) {
          return result();
        }
        return snapshot
          ? result([{ snapshot }])
          : result();
      }

      throw new Error(
        `Unexpected commerce v2 query: ${text}`
      );
    }
  };

  const authority = {
    async service(options, work) {
      calls.push({
        authority: structuredClone(options)
      });
      return work(client);
    }
  };

  return {
    authority,
    calls,
    commands,
    preparations,
    quotes
  };
}

function composition(harness, randomUUID = () => QUOTE_ID) {
  const adapter = createPostgresCommerceV2Adapter({
    authority: harness.authority,
    clock: () => NOW,
    randomUUID
  });
  const service = createCommerceV2Service({
    projects: adapter.projects,
    versions: adapter.versions,
    repository: adapter.repository,
    clock: adapter.clock,
    ids: adapter.ids
  });
  return {
    adapter,
    downloadCommerce:
      createHostedDownloadCommerce({
        boundary:
          createCommerceV2Boundary(service),
        resolveSession:
          adapter.resolveSession
      })
  };
}

test("canonical adapter resolves only the authenticated active editor project and accepted fact-set content", async () => {
  const harness = databaseHarness();
  const { adapter } = composition(harness);

  assert.deepEqual(
    await adapter.resolveSession({
      actor: { userId: USER_ID },
      projectId: PROJECT_ID
    }),
    {
      tenantId: ORGANIZATION_ID,
      customerId: USER_ID,
      actorId: USER_ID,
      projectId: PROJECT_ID
    }
  );
  assert.equal(
    await adapter.resolveSession({
      actor: { userId: OTHER_USER_ID },
      projectId: PROJECT_ID
    }),
    null
  );
  assert.deepEqual(
    await adapter.projects.resolveEditorProject({
      tenantId: ORGANIZATION_ID,
      customerId: USER_ID,
      projectId: PROJECT_ID
    }),
    {
      tenantId: ORGANIZATION_ID,
      customerId: USER_ID,
      projectId: PROJECT_ID,
      kind: "editor_project",
      purchaseEligible: true
    }
  );
  assert.equal(
    await adapter.projects.resolveEditorProject({
      tenantId: ORGANIZATION_ID,
      customerId: USER_ID,
      projectId: OTHER_PROJECT_ID
    }),
    null
  );
  assert.deepEqual(
    await adapter.versions.resolveAcceptedVersion({
      tenantId: ORGANIZATION_ID,
      customerId: USER_ID,
      projectId: PROJECT_ID,
      versionId: VERSION_ID
    }),
    {
      projectId: PROJECT_ID,
      versionId: VERSION_ID,
      state: "accepted",
      contentDigest: CONTENT_DIGEST
    }
  );
  assert.equal(
    await adapter.versions.resolveAcceptedVersion({
      tenantId: ORGANIZATION_ID,
      customerId: USER_ID,
      projectId: PROJECT_ID,
      versionId: OTHER_VERSION_ID
    }),
    null
  );

  const versionQuery = harness.calls.find(
    (call) =>
      call.text?.includes(
        "from ss.site_versions version"
      )
  );
  assert.match(
    versionQuery.text,
    /state\.state = 'accepted_release'/u
  );
  assert.match(
    versionQuery.text,
    /fact\.content_digest/u
  );
  assert.doesNotMatch(
    versionQuery.text,
    /artifact\.artifact_digest/u
  );
});

test("Download quote and held checkout preparation survive repository recreation and replay exactly", async () => {
  const harness = databaseHarness();
  const actor = { userId: USER_ID };
  let runtime = composition(harness);

  const quote =
    await runtime.downloadCommerce.createQuote(
      actor,
      PROJECT_ID,
      {
        versionId: VERSION_ID,
        commandId: "quote-command-1"
      }
    );
  assert.equal(quote.quoteId, QUOTE_ID);
  assert.equal(quote.offerId, "spark_download");
  assert.equal(quote.price.amountMinor, 500);
  assert.equal(quote.state, "held");
  assert.equal(quote.dispatchAuthorized, false);
  assert.equal(harness.quotes.size, 1);
  assert.equal(harness.commands.size, 1);
  assert.deepEqual(
    harness.commands.get(
      `${ORGANIZATION_ID}:quote-command-1`
    ),
    {
      organizationId: ORGANIZATION_ID,
      commandId: "quote-command-1",
      operation: "create_v2_quote",
      fingerprint:
        harness.commands.get(
          `${ORGANIZATION_ID}:quote-command-1`
        ).fingerprint,
      projectId: PROJECT_ID,
      customerId: USER_ID,
      actorId: USER_ID,
      state: "complete",
      result: harness.quotes.get(QUOTE_ID)
    }
  );

  runtime = composition(
    harness,
    () => {
      throw new Error(
        "replay must not allocate another quote ID"
      );
    }
  );
  assert.deepEqual(
    await runtime.downloadCommerce.createQuote(
      actor,
      PROJECT_ID,
      {
        versionId: VERSION_ID,
        commandId: "quote-command-1"
      }
    ),
    quote
  );
  assert.equal(harness.quotes.size, 1);

  assert.equal(
    await runtime.adapter.repository.findQuote({
      tenantId: ORGANIZATION_ID,
      customerId: OTHER_USER_ID,
      projectId: PROJECT_ID,
      quoteId: QUOTE_ID
    }),
    null
  );
  assert.equal(
    await runtime.adapter.repository.findQuote({
      tenantId: ORGANIZATION_ID,
      customerId: USER_ID,
      projectId: OTHER_PROJECT_ID,
      quoteId: QUOTE_ID
    }),
    null
  );

  const preparation =
    await runtime.downloadCommerce.prepareCheckout(
      actor,
      PROJECT_ID,
      quote.quoteId,
      {
        acceptedDisclosureDigest:
          quote.disclosureDigest,
        commandId: "checkout-command-1"
      }
    );
  assert.equal(preparation.state, "held");
  assert.equal(
    preparation.holdReason,
    "provider_dispatch_not_authorized"
  );
  assert.equal(
    preparation.dispatchAuthorized,
    false
  );
  assert.equal(preparation.provider, null);
  assert.equal(harness.preparations.size, 1);

  runtime = composition(harness);
  assert.deepEqual(
    await runtime.downloadCommerce.prepareCheckout(
      actor,
      PROJECT_ID,
      quote.quoteId,
      {
        acceptedDisclosureDigest:
          quote.disclosureDigest,
        commandId: "checkout-command-1"
      }
    ),
    preparation
  );
  assert.equal(harness.preparations.size, 1);
});

test("failed accepted-version resolution abandons only its pending durable command", async () => {
  const harness = databaseHarness();
  const { downloadCommerce } = composition(harness);

  await assert.rejects(
    downloadCommerce.createQuote(
      { userId: USER_ID },
      PROJECT_ID,
      {
        versionId: OTHER_VERSION_ID,
        commandId: "quote-command-failure"
      }
    ),
    (error) =>
      error.code ===
      "COMMERCE_V2_VERSION_UNAVAILABLE"
  );
  assert.equal(harness.commands.size, 0);
  assert.equal(harness.quotes.size, 0);
  assert.equal(harness.preparations.size, 0);
});

test("production composition keeps Download separately gated while sharing one Stripe adapter", async () => {
  const adapterSource = await readFile(
    new URL("../commerce-v2-postgres.mjs", import.meta.url),
    "utf8"
  );
  const serverSource = await readFile(
    new URL("../bin/server.mjs", import.meta.url),
    "utf8"
  );
  const paymentRepositorySource = await readFile(
    new URL("../download-payment-postgres.mjs", import.meta.url),
    "utf8"
  );

  assert.match(
    serverSource,
    /createPostgresCommerceV2Adapter\(\{[\s\S]*?createConfiguredStripeProvider\(\)[\s\S]*?createConfiguredDownloadPaymentRelease\(\)[\s\S]*?createDownloadPaymentService\(\{[\s\S]*?createPostgresDownloadPaymentRepository\(\{[\s\S]*?provider: stripeComposition\.adapter[\s\S]*?createHostedDownloadCommerce\(\{/u
  );
  assert.match(
    serverSource,
    /createHostedApi\(service, \{[\s\S]*?downloadCommerce,[\s\S]*?createStripeWebhookRouter\(\{[\s\S]*?provider: stripeComposition\.adapter,[\s\S]*?canonicalService: service,[\s\S]*?downloadCommerce/u
  );
  assert.doesNotMatch(
    adapterSource,
    /createConfiguredStripeProvider|paymentProvider|authorizeProjectEntitlement/u
  );
  assert.doesNotMatch(
    adapterSource,
    /\bfetch\s*\(|https?:|checkout\.stripe/u
  );
  assert.match(
    paymentRepositorySource,
    /commerce_v2_download_dispatches[\s\S]*commerce_v2_download_payment_receipts[\s\S]*commerce_v2_project_entitlements[\s\S]*commerce_v2_download_reversal_events/u
  );
  assert.doesNotMatch(
    paymentRepositorySource,
    /\bfetch\s*\(|https?:\/\//u
  );
});
