import assert from "node:assert/strict";
import test from "node:test";

import { digest } from "../../commerce-v2/canonical.mjs";
import { createAlakazamFulfillmentAuthority } from "../../commerce-v2/alakazam-fulfillment.mjs";
import { applyAlakazamCompilerPolicy } from "../alakazam-compiler-policy.mjs";

const IDS = Object.freeze({
  tenantId: "11111111-1111-4111-8111-111111111111",
  customerId: "22222222-2222-4222-8222-222222222222",
  projectId: "33333333-3333-4333-8333-333333333333",
  subscriptionId: "44444444-4444-4444-8444-444444444444"
});
const NOW = "2026-08-04T18:00:00.000Z";

function authority(tierId) {
  return createAlakazamFulfillmentAuthority({
    tenantId: IDS.tenantId,
    customerId: IDS.customerId,
    projectId: IDS.projectId,
    subscription: {
      ...IDS,
      tierId,
      status: "active",
      revision: 7,
      currentPeriodStartsAt: "2026-08-01T00:00:00.000Z",
      currentPeriodEndsAt: "2026-09-01T00:00:00.000Z",
      cancelAtPeriodEnd: false,
      graceEndsAt: null,
      scheduledTierId: null,
      scheduledEffectiveAt: null
    },
    expectedSubscriptionRevision: 7,
    now: NOW
  });
}

function configured(overrides = {}) {
  return {
    theme: " Arcane ",
    accent: "plum",
    fontPair: "alt",
    borderStyle: "ornate",
    cashapp: "Cedar.Pay",
    venmo: "Cedar-Pay",
    businessName: "Cedar & Stone",
    summary: "Local stonework with careful cleanup.",
    about: "Repairs and installations for nearby homes.",
    offerings: ["Repairs", "Installation"],
    location: "Richmond, Virginia",
    hours: "Monday through Friday",
    phone: "+1 (804) 555-0100",
    email: "hello@example.com",
    website: "https://example.com/",
    primaryAction: "email",
    photoHeader: { artifactId: "browser-claimed-photo" },
    sectionToggles: { about: false },
    versionHistory: 999,
    menu: ["premium", "browser", "claim"],
    providerPriceId: "price_browser_claim",
    unknownPremiumField: "must disappear",
    ...overrides
  };
}

test("canonical tier matrix masks unresolved fields and preserves configured facts", () => {
  for (const tierId of [
    "alakazam_25",
    "alakazam_35",
    "alakazam_50"
  ]) {
    const source = configured();
    const before = structuredClone(source);
    const selected = applyAlakazamCompilerPolicy({
      authority: authority(tierId),
      configuredFacts: source
    });
    const effective = selected.effectiveFacts;

    assert.deepEqual(source, before, `${tierId} configured facts changed`);
    assert.notEqual(effective, source);
    assert.notEqual(effective.offerings, source.offerings);
    assert.equal(effective.theme, "arcane");
    assert.equal(effective.accent, "plum");
    assert.equal(effective.fontPair, "standard");
    assert.equal(effective.borderStyle, "soft");
    assert.equal(effective.businessName, source.businessName);
    assert.equal(effective.primaryAction, "email");
    for (const masked of [
      "photoHeader",
      "sectionToggles",
      "versionHistory",
      "menu",
      "providerPriceId",
      "unknownPremiumField"
    ]) {
      assert.equal(
        Object.hasOwn(effective, masked),
        false,
        `${tierId} leaked ${masked}`
      );
    }

    const paymentLinksAllowed = tierId === "alakazam_50";
    assert.equal(Object.hasOwn(effective, "cashapp"), paymentLinksAllowed);
    assert.equal(Object.hasOwn(effective, "venmo"), paymentLinksAllowed);
    if (paymentLinksAllowed) {
      assert.equal(effective.cashapp, "Cedar.Pay");
      assert.equal(effective.venmo, "Cedar-Pay");
    }
    assert.equal(Object.isFrozen(selected), true);
    assert.equal(Object.isFrozen(selected.policy), true);
    assert.equal(Object.isFrozen(effective), true);
    assert.equal(Object.isFrozen(effective.offerings), true);
    assert.equal(selected.policyDigest, digest(selected.policy));
  }
});

test("all three base looks are authority-gated and remain distinct selections", () => {
  const expected = new Map([
    ["clear", "clear"],
    ["warm", "warm"],
    ["arcane", "arcane"]
  ]);
  for (const [configuredLook, effectiveLook] of expected) {
    const selected = applyAlakazamCompilerPolicy({
      authority: authority("alakazam_25"),
      configuredFacts: configured({ theme: configuredLook })
    });
    assert.equal(selected.effectiveFacts.theme, effectiveLook);
  }
  assert.throws(
    () => applyAlakazamCompilerPolicy({
      authority: authority("alakazam_25"),
      configuredFacts: configured({ theme: "browser-premium-look" })
    }),
    (error) => error?.code === "ALAKAZAM_LOOK_UNAVAILABLE"
  );
});

test("mutated, noncanonical, and browser-expanded authority fails closed", () => {
  const canonical = authority("alakazam_25");
  const extraAuthority = {
    ...structuredClone(canonical),
    providerPriceId: "price_browser_claim"
  };
  assert.throws(
    () => applyAlakazamCompilerPolicy({
      authority: extraAuthority,
      configuredFacts: configured()
    }),
    (error) =>
      error?.code === "ALAKAZAM_COMPILER_AUTHORITY_INVALID"
  );

  const extraPolicy = structuredClone(canonical);
  extraPolicy.policy.price = { amountMinor: 5000 };
  extraPolicy.policyDigest = digest(extraPolicy.policy);
  assert.throws(
    () => applyAlakazamCompilerPolicy({
      authority: extraPolicy,
      configuredFacts: configured()
    }),
    (error) =>
      error?.code === "ALAKAZAM_COMPILER_AUTHORITY_INVALID"
  );

  const forgedCapabilities = structuredClone(canonical);
  forgedCapabilities.policy.capabilities.push("cash_app_link");
  forgedCapabilities.policyDigest = digest(
    forgedCapabilities.policy
  );
  assert.throws(
    () => applyAlakazamCompilerPolicy({
      authority: forgedCapabilities,
      configuredFacts: configured()
    }),
    (error) =>
      error?.code === "ALAKAZAM_COMPILER_AUTHORITY_INVALID"
  );

  assert.throws(
    () => applyAlakazamCompilerPolicy({
      authority: canonical,
      configuredFacts: configured(),
      tierId: "alakazam_50"
    }),
    (error) => error?.code === "ALAKAZAM_COMPILER_INPUT_INVALID"
  );
});
