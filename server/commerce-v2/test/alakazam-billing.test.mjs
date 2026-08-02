import assert from "node:assert/strict";
import test from "node:test";

import {
  createAlakazamBillingRelease,
  createAlakazamBillingService,
  quoteAlakazamChange
} from "../index.mjs";

const NOW = "2026-08-02T12:00:00.000Z";
const EXPIRES_AT = "2026-08-02T12:30:00.000Z";
const TENANT_ID =
  "10000000-0000-4000-8000-000000000001";
const CUSTOMER_ID =
  "20000000-0000-4000-8000-000000000001";
const PROJECT_ID =
  "30000000-0000-4000-8000-000000000001";
const QUOTE_ID =
  "40000000-0000-4000-8000-000000000001";

function input(overrides = {}) {
  return {
    tenantId: TENANT_ID,
    customerId: CUSTOMER_ID,
    projectId: PROJECT_ID,
    quoteId: QUOTE_ID,
    targetTierId: "alakazam_25",
    ...overrides
  };
}

function fixture({
  approved = true,
  taxMode = "disabled_by_owner",
  providerStatus = null,
  repositoryResult = null
} = {}) {
  const calls = {
    readiness: 0,
    quotes: []
  };
  const provider = {
    async readiness() {
      calls.readiness += 1;
      return providerStatus ?? {
        ready: true,
        provider: "stripe",
        alakazam: true,
        livemode: false,
        taxMode
      };
    }
  };
  const repository = {
    async createQuote(value) {
      calls.quotes.push(structuredClone(value));
      return repositoryResult ?? quoteAlakazamChange({
        quoteId: value.quoteId,
        tenantId: value.tenantId,
        customerId: value.customerId,
        projectId: value.projectId,
        targetTierId: value.targetTierId,
        issuedAt: value.issuedAt,
        expiresAt: value.expiresAt,
        providerEffectsAuthorized: true,
        taxMode: value.taxMode
      });
    }
  };
  const service = createAlakazamBillingService({
    repository,
    provider,
    clock: { now: () => NOW },
    release: createAlakazamBillingRelease({
      approved,
      taxMode: approved ? taxMode : null
    })
  });
  return { service, calls };
}

test("Alakazam billing is held before repository or provider authority", async () => {
  const { service, calls } = fixture({ approved: false });
  assert.deepEqual(await service.readiness(), {
    ready: false,
    quote: false,
    payment: false,
    state: "held",
    code: "alakazam_billing_release_held"
  });
  await assert.rejects(
    service.createQuote(input()),
    (error) => error.code === "alakazam_billing_unavailable"
  );
  assert.equal(calls.readiness, 0);
  assert.equal(calls.quotes.length, 0);
});

test("Alakazam quote readiness requires the exact reviewed provider and tax mode", async () => {
  for (const providerStatus of [
    {
      ready: true,
      provider: "stripe",
      alakazam: false,
      livemode: false,
      taxMode: "disabled_by_owner"
    },
    {
      ready: true,
      provider: "stripe",
      alakazam: true,
      livemode: false,
      taxMode: "automatic"
    }
  ]) {
    const { service, calls } = fixture({ providerStatus });
    const status = await service.readiness();
    assert.equal(status.ready, false);
    await assert.rejects(
      service.createQuote(input()),
      (error) =>
        error.code === "alakazam_billing_unavailable"
    );
    assert.equal(calls.quotes.length, 0);
  }
});

test("Alakazam quote sends only identity, target, server time, and reviewed tax authority to the repository", async () => {
  const { service, calls } = fixture();
  const quote = await service.createQuote(input());
  assert.equal(quote.state, "quoted");
  assert.equal(quote.providerEffectsAuthorized, true);
  assert.equal(
    quote.dueNow.taxState,
    "disabled_by_owner"
  );
  assert.equal(quote.dueNow.totalMinor, 2500);
  assert.deepEqual(calls.quotes, [
    {
      ...input(),
      issuedAt: NOW,
      expiresAt: EXPIRES_AT,
      taxMode: "disabled_by_owner"
    }
  ]);
  assert.equal(
    Object.hasOwn(calls.quotes[0], "amountMinor"),
    false
  );
  assert.equal(
    Object.hasOwn(calls.quotes[0], "downloadCredit"),
    false
  );
  assert.equal(
    Object.hasOwn(calls.quotes[0], "currentSubscription"),
    false
  );
});

test("Alakazam quote rejects browser money or subscription authority before provider readiness", async () => {
  for (const forged of [
    { amountMinor: 1 },
    { downloadCredit: { amountMinor: 500 } },
    { currentSubscription: { tierId: "alakazam_50" } },
    { stripePriceId: "price_forged" }
  ]) {
    const { service, calls } = fixture();
    await assert.rejects(
      service.createQuote(input(forged)),
      (error) => error.code === "invalid_input"
    );
    assert.equal(calls.readiness, 0);
    assert.equal(calls.quotes.length, 0);
  }
});

test("Alakazam quote refuses a repository result with changed money or digest", async () => {
  const changed = structuredClone(
    quoteAlakazamChange({
      ...input(),
      issuedAt: NOW,
      expiresAt: EXPIRES_AT,
      providerEffectsAuthorized: true,
      taxMode: "disabled_by_owner"
    })
  );
  changed.dueNow.subtotalMinor = 1;
  const { service } = fixture({ repositoryResult: changed });
  await assert.rejects(
    service.createQuote(input()),
    (error) => error.code === "repository_conflict"
  );
});
