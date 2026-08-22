import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { ExternalEffectError } from "../../domain/errors.mjs";
import {
  CHECKOUT_COMMAND_SCHEMA,
  CHECKOUT_PURPOSE_SCHEMA,
  ENTITLEMENT_SCHEMA,
  createDownloadPaymentRelease,
  createDownloadPaymentService,
  digest
} from "../index.mjs";

const NOW = "2026-08-02T12:00:00.000Z";
const TENANT_ID = "tenant_download_a";
const CUSTOMER_ID = "customer_download_a";
const PROJECT_ID = "project_download_a";
const VERSION_ID = "version_download_a";
const QUOTE_ID = "quote_download_a";
const COMMAND_ID = "checkout_download_a";
const VERIFIED_EMAIL = "owner@example.com";
const VERIFIED_EMAIL_DIGEST = createHash("sha256")
  .update(VERIFIED_EMAIL, "utf8")
  .digest("hex");
const HTML = Buffer.from(
  "<!doctype html><title>Paid Download</title>",
  "utf8"
);
const ARTIFACT_DIGEST = createHash("sha256")
  .update(HTML)
  .digest("hex");

function preparation() {
  const purpose = {
    schema: CHECKOUT_PURPOSE_SCHEMA,
    tenantId: TENANT_ID,
    customerId: CUSTOMER_ID,
    projectId: PROJECT_ID,
    versionId: VERSION_ID,
    quoteId: QUOTE_ID,
    quoteSnapshotDigest: "a".repeat(64),
    acceptedDisclosureDigest: "b".repeat(64),
    offerId: "spark_download",
    entitlementKind: "spark_download",
    purchaseTermsAccepted: true,
    price: {
      amountMinor: 2000,
      currency: "USD",
      billing: "one_time",
      interval: null
    }
  };
  return {
    schema: CHECKOUT_COMMAND_SCHEMA,
    commandId: COMMAND_ID,
    quoteId: QUOTE_ID,
    projectId: PROJECT_ID,
    versionId: VERSION_ID,
    offerId: "spark_download",
    entitlementKind: "spark_download",
    state: "held",
    holdReason: "provider_dispatch_not_authorized",
    dispatchAuthorized: false,
    provider: null,
    preparedAt: NOW,
    acceptance: {
      schema:
        "sitesourcery.abracadabra-purchase-acceptance.v1",
      statement:
        "accepted_exact_download_quote_delivery_final_sale_and_credit_terms",
      acceptedAt: NOW,
      requestId: "request_download_a",
      clientAddress: "192.0.2.10",
      userAgentDigest: "c".repeat(64),
      acceptedDisclosureDigest: "b".repeat(64),
      termsVersion:
        "spark-download-protection.2026-08-22.v2"
    },
    purpose,
    purposeDigest: digest(purpose)
  };
}

function metadata(selected = preparation()) {
  return {
    schema: "sitesourcery_download_checkout_v3",
    tenant_id: TENANT_ID,
    customer_id: CUSTOMER_ID,
    project_id: PROJECT_ID,
    version_id: VERSION_ID,
    quote_id: QUOTE_ID,
    offer_id: "spark_download",
    entitlement_kind: "spark_download",
    accepted_disclosure_digest:
      selected.purpose.acceptedDisclosureDigest,
    quote_snapshot_digest:
      selected.purpose.quoteSnapshotDigest,
    purpose_digest: selected.purposeDigest
  };
}

function verifiedEvent(overrides = {}) {
  return {
    id: "evt_download_1",
    type: "checkout.session.completed",
    livemode: false,
    created: 1785672300,
    data: {
      object: {
        id: "cs_test_download_1",
        metadata: metadata(),
        amount_total: 1,
        ...overrides
      }
    }
  };
}

function refundEvent({
  eventId = "evt_download_refund_1",
  amountRefunded = 2000
} = {}) {
  return {
    id: eventId,
    type: "charge.refunded",
    livemode: false,
    created: 1785672400,
    data: {
      object: {
        id: "ch_test_download_1",
        livemode: false,
        payment_intent:
          "pi_test_download_1",
        currency: "usd",
        amount: 2000,
        amount_refunded: amountRefunded,
        refunded: amountRefunded === 2000
      }
    }
  };
}

function disputeEvent({
  eventId = "evt_download_dispute_1",
  status = "needs_response"
} = {}) {
  return {
    id: eventId,
    type: "charge.dispute.created",
    livemode: false,
    created: 1785672500,
    data: {
      object: {
        id: "du_test_download_1",
        livemode: false,
        payment_intent:
          "pi_test_download_1",
        currency: "usd",
        amount: 2000,
        status
      }
    }
  };
}

function earlyFraudWarningEvent({
  eventId = "evt_download_early_fraud_1",
  actionable = true
} = {}) {
  return {
    id: eventId,
    type: "radar.early_fraud_warning.created",
    livemode: false,
    created: 1785672600,
    data: {
      object: {
        id: "issfr_test_download_1",
        livemode: false,
        actionable,
        fraud_type: "card_never_received",
        charge: "ch_test_download_1",
        payment_intent: "pi_test_download_1"
      }
    }
  };
}

function fixture({
  approved = true,
  taxMode = "disabled_by_owner",
  stripeCustomerId = null,
  createError = null,
  completeError = null,
  checkoutLifecycle = "expired_unpaid"
} = {}) {
  const calls = {
    readiness: 0,
    readinessPurposes: [],
    create: [],
    retrieve: [],
    lifecycle: [],
    unknown: [],
    abandoned: [],
    expired: [],
    settlements: [],
    reversals: [],
    fraudWarnings: [],
    accesses: []
  };
  let dispatch = null;
  let entitlement = null;
  let receipt = null;
  const events = new Map();
  let sequence = 0;
  const repository = {
    async findVerifiedCheckoutIdentity(input) {
      assert.equal(input.tenantId, TENANT_ID);
      assert.equal(input.customerId, CUSTOMER_ID);
      return {
        verified: true,
        userId: CUSTOMER_ID,
        email: VERIFIED_EMAIL,
        emailDigest: VERIFIED_EMAIL_DIGEST,
        accountCreatedAt:
          "2026-08-01T10:00:00.000Z",
        activatedAt:
          "2026-08-01T10:05:00.000Z",
        possessionEvidenceDigest:
          "d".repeat(64)
      };
    },
    async findStripeCustomer(input) {
      assert.equal(input.tenantId, TENANT_ID);
      assert.equal(input.customerId, CUSTOMER_ID);
      return stripeCustomerId;
    },
    async findProjectEntitlement() {
      return entitlement?.state === "active"
        ? structuredClone(entitlement)
        : null;
    },
    async findPaymentReceiptByIntent({
      paymentIntentId
    }) {
      return receipt?.paymentIntentId ===
        paymentIntentId
        ? structuredClone(receipt)
        : null;
    },
    async claimDispatch(selected) {
      if (!dispatch) {
        dispatch = {
          state: "dispatching",
          preparation: structuredClone(selected)
        };
        return { status: "claimed" };
      }
      if (dispatch.state === "ready") {
        return {
          status: "replay",
          result: structuredClone(dispatch.result)
        };
      }
      if (dispatch.state === "ready_expired") {
        return {
          status: "reconcile_expiry",
          reconciliation: {
            preparation: structuredClone(
              dispatch.preparation
            ),
            result: structuredClone(dispatch.result),
            checkoutSessionId:
              dispatch.result.checkout.id
          }
        };
      }
      if (dispatch.state === "effect_unknown") {
        return { status: "effect_unknown" };
      }
      return { status: "pending" };
    },
    async completeDispatch(selected, result) {
      assert.equal(selected.commandId, COMMAND_ID);
      if (completeError) throw completeError;
      dispatch = {
        state: "ready",
        preparation: structuredClone(selected),
        result: structuredClone(result)
      };
    },
    async expireDispatch(selected) {
      calls.expired.push(structuredClone(selected));
      assert.equal(
        selected.checkoutSessionId,
        "cs_test_download_1"
      );
      assert.equal(dispatch.state, "ready_expired");
      dispatch.state = "expired";
    },
    async markDispatchUnknown(selected, code) {
      calls.unknown.push({
        commandId: selected.commandId,
        code
      });
      dispatch.state = "effect_unknown";
    },
    async abandonDispatch(selected) {
      calls.abandoned.push(selected.commandId);
      dispatch = null;
    },
    async findDispatchByCheckout({
      checkoutSessionId
    }) {
      if (
        dispatch?.result?.checkout?.id !==
        checkoutSessionId
      ) {
        return null;
      }
      return {
        commandId: COMMAND_ID,
        provider: "stripe",
        state: dispatch.state,
        checkoutSessionId,
        purpose: structuredClone(
          dispatch.preparation.purpose
        ),
        purposeDigest:
          dispatch.preparation.purposeDigest
      };
    },
    async claimStripeEvent(event) {
      const existing = events.get(event.eventId);
      if (!existing) {
        events.set(event.eventId, {
          event: structuredClone(event),
          state: "pending",
          result: null
        });
        return { status: "claimed" };
      }
      assert.equal(
        existing.event.payloadDigest,
        event.payloadDigest
      );
      return existing.state === "processed"
        ? {
            status: "replay",
            result: structuredClone(existing.result)
          }
        : { status: "pending" };
    },
    async settleStripeEvent(input) {
      calls.settlements.push(structuredClone(input));
      entitlement = {
        schema: ENTITLEMENT_SCHEMA,
        entitlementId: input.entitlementId,
        tenantId: TENANT_ID,
        customerId: CUSTOMER_ID,
        projectId: PROJECT_ID,
        kind: "spark_download",
        scope: "editor_project",
        state: "active",
        activatedAt: input.settledAt,
        expiresAt: null,
        acceptedDisclosureDigest:
          preparation().purpose
            .acceptedDisclosureDigest,
        payment: {
          receiptId: input.receiptId
        }
      };
      receipt = {
        receiptId: input.receiptId,
        tenantId: TENANT_ID,
        customerId: CUSTOMER_ID,
        projectId: PROJECT_ID,
        entitlementId: input.entitlementId,
        entitlementState: "active",
        paymentIntentId:
          input.payment.paymentIntentId,
        amountMinor: 2000,
        taxMinor: input.payment.taxMinor,
        totalMinor: input.payment.totalMinor,
        currency: "USD"
      };
      dispatch.state = "settled";
      const result = {
        status: "processed",
        projectId: PROJECT_ID,
        entitlementId: input.entitlementId
      };
      const event = events.get(input.event.eventId);
      event.state = "processed";
      event.result = structuredClone(result);
      return result;
    },
    async applyPaymentReversal(input) {
      calls.reversals.push(structuredClone(input));
      if (
        !receipt ||
        input.receipt.receiptId !==
          receipt.receiptId
      ) {
        throw new Error("receipt mismatch");
      }
      const severity = {
        active: 0,
        suspended: 1,
        revoked: 2
      };
      if (
        severity[input.decision.targetState] >
        severity[entitlement.state]
      ) {
        entitlement.state =
          input.decision.targetState;
        receipt.entitlementState =
          input.decision.targetState;
      }
      return {
        status: "processed",
        projectId: PROJECT_ID,
        entitlementId: entitlement.entitlementId,
        entitlementState: entitlement.state,
        reason: input.decision.reason
      };
    },
    async applyEarlyFraudWarning(input) {
      calls.fraudWarnings.push(
        structuredClone(input)
      );
      return {
        status: "processed",
        actionable: input.warning.actionable,
        projectId: PROJECT_ID,
        entitlementId: entitlement.entitlementId,
        entitlementState: entitlement.state,
        checkoutGate:
          input.warning.actionable
            ? "held"
            : "unchanged"
      };
    },
    async recordDownloadAccess(input) {
      calls.accesses.push(structuredClone(input));
      return {
        recorded: true,
        accessEventId: "access_download_1"
      };
    },
    async resolveDownloadArtifact(input) {
      if (
        entitlement?.state !== "active" ||
        input.tenantId !== TENANT_ID ||
        input.customerId !== CUSTOMER_ID ||
        input.projectId !== PROJECT_ID ||
        input.versionId !== VERSION_ID
      ) {
        return null;
      }
      return {
        entitlement: structuredClone(entitlement),
        versionProjectId: PROJECT_ID,
        htmlBytes: Buffer.from(HTML),
        artifactDigest: ARTIFACT_DIGEST
      };
    }
  };
  const provider = {
    async readiness() {
      calls.readiness += 1;
      return {
        ready: true,
        provider: "stripe",
        taxModes: { download: taxMode }
      };
    },
    async readinessForPurpose(purpose) {
      calls.readiness += 1;
      calls.readinessPurposes.push(purpose);
      return {
        ready: true,
        provider: "stripe",
        purpose,
        taxModes: { download: taxMode }
      };
    },
    async createDownloadCheckout(input) {
      calls.create.push(structuredClone(input));
      if (createError) throw createError;
      return {
        checkoutId: "cs_test_download_1",
        url:
          "https://checkout.stripe.com/c/pay/download_1",
        expiresAt:
          "2026-08-02T12:30:00.000Z"
      };
    },
    async retrieveDownloadCheckout(input) {
      calls.retrieve.push(structuredClone(input));
      return {
        schema:
          "sitesourcery.stripe-download-payment-facts/v2",
        provider: "stripe",
        checkoutSessionId:
          "cs_test_download_1",
        paymentIntentId: "pi_test_download_1",
        customerId: "cus_test_download_1",
        paymentStatus: "paid",
        amountMinor: 2000,
        taxMinor:
          taxMode === "automatic" ? 33 : 0,
        totalMinor:
          taxMode === "automatic" ? 2033 : 2000,
        taxMode,
        currency: "USD",
        purposeDigest: preparation().purposeDigest,
        verifiedEmailDigest:
          VERIFIED_EMAIL_DIGEST,
        accountCreatedAt:
          "2026-08-01T10:00:00.000Z",
        accountActivatedAt:
          "2026-08-01T10:05:00.000Z",
        possessionEvidenceDigest:
          "d".repeat(64),
        billingIdentity: {
          email: VERIFIED_EMAIL,
          name: "Owner",
          address: {
            city: "Mickleton",
            country: "US",
            line1: "1 Main St",
            line2: null,
            postalCode: "08056",
            state: "NJ"
          }
        },
        billingIdentityDigest: digest({
          email: VERIFIED_EMAIL,
          name: "Owner",
          address: {
            city: "Mickleton",
            country: "US",
            line1: "1 Main St",
            line2: null,
            postalCode: "08056",
            state: "NJ"
          }
        }),
        threeDS: {
          requested: "any",
          supported: true,
          result: "authenticated"
        },
        chargeId: "ch_test_download_1",
        riskLevel: "normal",
        riskScore: 10
      };
    },
    async retrieveDownloadCheckoutLifecycle(input) {
      calls.lifecycle.push(structuredClone(input));
      return {
        schema:
          "sitesourcery.stripe-download-checkout-lifecycle/v2",
        provider: "stripe",
        checkoutSessionId:
          "cs_test_download_1",
        state: checkoutLifecycle
      };
    }
  };
  const service = createDownloadPaymentService({
    repository,
    provider,
    release: createDownloadPaymentRelease({
      approved
    }),
    clock: { now: () => NOW },
    ids: {
      next(prefix) {
        sequence += 1;
        return `${prefix}_${sequence}`;
      }
    }
  });
  return {
    calls,
    checkoutIdentity: {
      verified: true,
      userId: CUSTOMER_ID,
      email: VERIFIED_EMAIL,
      emailDigest: VERIFIED_EMAIL_DIGEST,
      accountCreatedAt:
        "2026-08-01T10:00:00.000Z",
      activatedAt:
        "2026-08-01T10:05:00.000Z",
      possessionEvidenceDigest:
        "d".repeat(64)
    },
    get dispatch() {
      return dispatch;
    },
    get entitlement() {
      return entitlement;
    },
    markCheckoutLocallyExpired() {
      assert.equal(dispatch?.state, "ready");
      dispatch.state = "ready_expired";
    },
    service
  };
}

test("Download payment remains held without the explicit release", async () => {
  const context = fixture({ approved: false });
  assert.deepEqual(await context.service.readiness(), {
    ready: false,
    payment: false,
    state: "held",
    code: "download_payment_release_held"
  });
  assert.equal(context.calls.readiness, 0);
  await assert.rejects(
    context.service.dispatch(preparation()),
    (error) => error.code === "payment_unavailable"
  );
  assert.equal(context.calls.create.length, 0);
});

test("automatic tax is a valid exact $20 item-plus-tax contract", async () => {
  const context = fixture({ taxMode: "automatic" });
  assert.deepEqual(await context.service.readiness(), {
    ready: true,
    payment: true,
    state: "ready",
    provider: "stripe",
    taxMode: "automatic"
  });
  assert.deepEqual(context.calls.readinessPurposes, [
    "download"
  ]);
  await context.service.dispatch(preparation());
  await context.service.ingestStripeEvent(
    verifiedEvent()
  );
  assert.equal(
    context.calls.settlements[0].payment.taxMinor,
    33
  );
  assert.equal(
    context.calls.settlements[0].payment.totalMinor,
    2033
  );
});

test("one durable Download dispatch replays one Stripe Checkout without a second effect", async () => {
  const context = fixture();
  const first =
    await context.service.dispatch(preparation());
  assert.equal(first.state, "ready");
  assert.equal(first.dispatchAuthorized, true);
  assert.equal(first.provider, "stripe");
  assert.equal(
    first.checkoutUrl,
    "https://checkout.stripe.com/c/pay/download_1"
  );
  const replay =
    await context.service.dispatch(preparation());
  assert.deepEqual(replay, first);
  assert.equal(context.calls.create.length, 1);
  assert.deepEqual(context.calls.create[0], {
    checkoutIdentity: context.checkoutIdentity,
    idempotencyKey: COMMAND_ID,
    purpose: preparation().purpose,
    purposeDigest: preparation().purposeDigest
  });
});

test("an expired Checkout is replaceable only after Stripe proves it stayed unpaid", async () => {
  const context = fixture();
  await context.service.dispatch(preparation());
  context.markCheckoutLocallyExpired();
  await assert.rejects(
    context.service.dispatch(preparation()),
    (error) => error.code === "checkout_expired"
  );
  assert.equal(context.calls.create.length, 1);
  assert.equal(context.calls.lifecycle.length, 1);
  assert.equal(context.calls.expired.length, 1);
});

test("a completed Checkout with delayed webhook blocks every replacement charge", async () => {
  const context = fixture({
    checkoutLifecycle: "completion_pending"
  });
  await context.service.dispatch(preparation());
  context.markCheckoutLocallyExpired();
  await assert.rejects(
    context.service.dispatch(preparation()),
    (error) =>
      error.code ===
      "payment_reconciliation_required"
  );
  assert.equal(context.calls.create.length, 1);
  assert.equal(context.calls.lifecycle.length, 1);
  assert.equal(context.calls.expired.length, 0);
});

test("Download Checkout reuses the organization's bound Stripe Customer", async () => {
  const context = fixture({
    stripeCustomerId: "cus_test_account_1"
  });
  await context.service.dispatch(preparation());
  assert.deepEqual(context.calls.create[0], {
    checkoutIdentity: context.checkoutIdentity,
    idempotencyKey: COMMAND_ID,
    purpose: preparation().purpose,
    purposeDigest: preparation().purposeDigest,
    stripeCustomerId: "cus_test_account_1"
  });
});

test("ambiguous Checkout creation is terminal and never automatically repeated", async () => {
  const context = fixture({
    createError: new ExternalEffectError(
      "stripe_download_checkout_effect_unknown",
      "network ended after submit",
      { certainty: "ambiguous" }
    )
  });
  await assert.rejects(
    context.service.dispatch(preparation()),
    (error) =>
      error.code ===
      "payment_reconciliation_required"
  );
  await assert.rejects(
    context.service.dispatch(preparation()),
    (error) =>
      error.code ===
      "payment_reconciliation_required"
  );
  assert.equal(context.calls.create.length, 1);
  assert.deepEqual(context.calls.unknown, [
    {
      commandId: COMMAND_ID,
      code:
        "stripe_download_checkout_effect_unknown"
    }
  ]);
});

test("a Checkout returned by Stripe is held when durable dispatch persistence fails", async () => {
  const context = fixture({
    completeError: new Error(
      "database write unavailable"
    )
  });
  await assert.rejects(
    context.service.dispatch(preparation()),
    (error) =>
      error.code ===
      "payment_reconciliation_required"
  );
  await assert.rejects(
    context.service.dispatch(preparation()),
    (error) =>
      error.code ===
      "payment_reconciliation_required"
  );
  assert.equal(context.calls.create.length, 1);
  assert.deepEqual(context.calls.abandoned, []);
  assert.deepEqual(context.calls.unknown, [
    {
      commandId: COMMAND_ID,
      code:
        "download_checkout_persistence_unknown"
    }
  ]);
});

test("verified webhook is only a wake-up signal; Stripe readback issues one entitlement", async () => {
  const context = fixture();
  await context.service.dispatch(preparation());
  const first = await context.service.ingestStripeEvent(
    verifiedEvent()
  );
  const replay =
    await context.service.ingestStripeEvent(
      verifiedEvent()
    );
  assert.deepEqual(replay, first);
  assert.equal(first.status, "processed");
  assert.equal(context.calls.retrieve.length, 1);
  assert.equal(context.calls.settlements.length, 1);
  assert.equal(context.entitlement.state, "active");
  assert.equal(context.entitlement.expiresAt, null);
});

test("verified Download metadata must match the durable preparation before readback", async () => {
  const context = fixture();
  await context.service.dispatch(preparation());
  await assert.rejects(
    context.service.ingestStripeEvent(
      verifiedEvent({
        metadata: {
          ...metadata(),
          project_id: "project_attacker"
        }
      })
    ),
    (error) =>
      error.code === "stripe_event_binding_invalid"
  );
  assert.equal(context.calls.retrieve.length, 0);
  assert.equal(context.calls.settlements.length, 0);
});

test("active project entitlement delivers only the exact accepted artifact and does not consume it", async () => {
  const context = fixture();
  await context.service.dispatch(preparation());
  await context.service.ingestStripeEvent(
    verifiedEvent()
  );
  const input = {
    tenantId: TENANT_ID,
    customerId: CUSTOMER_ID,
    projectId: PROJECT_ID,
    versionId: VERSION_ID,
    requestId: "request_download_1",
    clientAddress: "192.0.2.10",
    userAgentDigest: "e".repeat(64)
  };
  const first = await context.service.download(input);
  const repeat = await context.service.download(input);
  assert.deepEqual(first, repeat);
  assert.deepEqual(first.bytes, HTML);
  assert.equal(first.sha256, ARTIFACT_DIGEST);
  assert.match(first.filename, /\.html$/u);
  await assert.rejects(
    context.service.download({
      ...input,
      versionId: "version_foreign"
    }),
    (error) => error.code === "entitlement_unavailable"
  );
});

test("a full Stripe refund revokes Download and duplicate delivery is idempotent", async () => {
  const context = fixture();
  await context.service.dispatch(preparation());
  await context.service.ingestStripeEvent(
    verifiedEvent()
  );
  const first =
    await context.service.ingestStripeEvent(
      refundEvent()
    );
  const replay =
    await context.service.ingestStripeEvent(
      refundEvent()
    );
  assert.equal(first.entitlementState, "revoked");
  assert.deepEqual(replay, first);
  assert.equal(context.calls.reversals.length, 2);
  await assert.rejects(
    context.service.download({
      tenantId: TENANT_ID,
      customerId: CUSTOMER_ID,
      projectId: PROJECT_ID,
      versionId: VERSION_ID,
      requestId: "request_download_refund",
      clientAddress: "192.0.2.10",
      userAgentDigest: "e".repeat(64)
    }),
    (error) =>
      error.code === "entitlement_unavailable"
  );
});

test("a partial refund or open dispute suspends Download pending owner review", async () => {
  for (const reversal of [
    refundEvent({ amountRefunded: 100 }),
    disputeEvent()
  ]) {
    const context = fixture();
    await context.service.dispatch(preparation());
    await context.service.ingestStripeEvent(
      verifiedEvent()
    );
    const result =
      await context.service.ingestStripeEvent(
        reversal
      );
    assert.equal(
      result.entitlementState,
      "suspended"
    );
  }
});

test("an actionable Stripe early fraud warning enters owner review without trusting browser claims", async () => {
  const context = fixture();
  await context.service.dispatch(preparation());
  await context.service.ingestStripeEvent(
    verifiedEvent()
  );
  const result = await context.service.ingestStripeEvent(
    earlyFraudWarningEvent()
  );
  assert.deepEqual(result, {
    status: "processed",
    actionable: true,
    projectId: PROJECT_ID,
    entitlementId: context.entitlement.entitlementId,
    entitlementState: "active",
    checkoutGate: "held"
  });
  assert.equal(context.calls.fraudWarnings.length, 1);
  assert.deepEqual(
    context.calls.fraudWarnings[0].warning,
    {
      warningId: "issfr_test_download_1",
      chargeId: "ch_test_download_1",
      paymentIntentId: "pi_test_download_1",
      actionable: true,
      fraudType: "card_never_received"
    }
  );
});

test("a reversal for another PaymentIntent falls through to canonical commerce", async () => {
  const context = fixture();
  assert.deepEqual(
    await context.service.ingestStripeEvent(
      refundEvent()
    ),
    { status: "not_download" }
  );
  assert.equal(context.calls.reversals.length, 0);
});
