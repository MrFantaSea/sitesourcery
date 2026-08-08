import assert from "node:assert/strict";
import test from "node:test";

import {
  ALAKAZAM_INVOICE_SCHEMA,
  alakazamInvoiceNumber,
  projectAlakazamInvoice
} from "../alakazam-billing-invoice.mjs";
import {
  createHeldHostedAlakazamBillingSurfaces,
  createHostedAlakazamBillingSurfaces,
  matchAlakazamBillingSurfaceRoute,
  readAlakazamBillingSurface
} from "../alakazam-billing.mjs";

const TENANT_ID = "10000000-0000-4000-8000-000000000001";
const CUSTOMER_ID = "20000000-0000-4000-8000-000000000001";
const OTHER_CUSTOMER_ID =
  "20000000-0000-4000-8000-000000000002";
const PROJECT_ID = "30000000-0000-4000-8000-000000000001";
const RECEIPT_ID = "40000000-0000-4000-8000-000000000001";
const SETTLEMENT_DIGEST = "a".repeat(64);

function scope(overrides = {}) {
  return {
    tenantId: TENANT_ID,
    customerId: CUSTOMER_ID,
    actorId: CUSTOMER_ID,
    projectId: PROJECT_ID,
    ...overrides
  };
}

function storedInvoice(overrides = {}) {
  return {
    projectId: PROJECT_ID,
    receiptId: RECEIPT_ID,
    kind: "start_payment",
    tierId: "alakazam_25",
    subtotalMinor: 2500,
    discountMinor: 500,
    netSubtotalMinor: 2000,
    taxMinor: 0,
    totalMinor: 2000,
    taxMode: "disabled_by_owner",
    currency: "USD",
    settledAt: "2026-08-08T12:00:00.000Z",
    settlementDigest: SETTLEMENT_DIGEST,
    providerInvoiceRecorded: true,
    ...overrides
  };
}

function boundary(
  readCustomerInvoice,
  { tenantId = TENANT_ID } = {}
) {
  return createHostedAlakazamBillingSurfaces({
    repository: {
      readCustomerInvoice,
      async readCustomerBillingStates() {
        throw new Error("unused");
      }
    },
    account: {
      async read() {
        throw new Error("unused");
      }
    },
    async resolveSession({ actor, projectId }) {
      return {
        tenantId,
        customerId: actor.userId,
        actorId: actor.userId,
        projectId
      };
    }
  });
}

test("A-03 projects one settled receipt into a customer-safe invoice document", () => {
  const invoice = projectAlakazamInvoice(
    storedInvoice(),
    scope(),
    RECEIPT_ID
  );
  assert.equal(invoice.schema, ALAKAZAM_INVOICE_SCHEMA);
  assert.equal(invoice.projectId, PROJECT_ID);
  assert.equal(invoice.receiptId, RECEIPT_ID);
  assert.equal(
    invoice.invoiceNumber,
    "SSAK-40000000000040008000000000000001"
  );
  assert.equal(invoice.state, "settled");
  assert.equal(invoice.kind, "start_payment");
  assert.deepEqual(invoice.tier, {
    tierId: "alakazam_25",
    name: "Alakazam 25"
  });
  assert.equal(
    invoice.issuedAt,
    "2026-08-08T12:00:00.000Z"
  );
  assert.deepEqual(invoice.lines, [
    {
      lineNumber: 1,
      description: "Alakazam first month",
      quantity: 1,
      unitAmountMinor: 2500,
      amountMinor: 2500
    }
  ]);
  assert.deepEqual(invoice.credits, [
    {
      kind: "download_purchase",
      description: "Download purchase credit",
      amountMinor: 500
    }
  ]);
  assert.deepEqual(invoice.totals, {
    subtotalMinor: 2500,
    discountMinor: 500,
    netSubtotalMinor: 2000,
    taxMinor: 0,
    taxState: "disabled_by_owner",
    totalMinor: 2000,
    currency: "USD"
  });
  assert.equal(
    invoice.settlement.providerInvoiceRecorded,
    true
  );
  assert.equal(
    invoice.settlement.settlementDigest,
    SETTLEMENT_DIGEST
  );
  assert.equal(Object.isFrozen(invoice), true);
});

test("the invoice document never carries a provider identifier", () => {
  const serialized = JSON.stringify(
    projectAlakazamInvoice(
      storedInvoice(),
      scope(),
      RECEIPT_ID
    )
  );
  for (const prefix of [
    "cus_",
    "sub_",
    "in_",
    "pi_",
    "evt_",
    "price_",
    "cs_"
  ]) {
    assert.equal(
      serialized.includes(prefix),
      false,
      `invoice exposed ${prefix}`
    );
  }
  assert.equal(serialized.includes("stripe"), false);
});

test("a renewal receipt carries no quote and resolves its tier from the exact amount charged", () => {
  const invoice = projectAlakazamInvoice(
    storedInvoice({
      kind: "renewal_payment",
      tierId: null,
      subtotalMinor: 5000,
      discountMinor: 0,
      netSubtotalMinor: 5000,
      taxMinor: 0,
      totalMinor: 5000
    }),
    scope(),
    RECEIPT_ID
  );
  assert.equal(invoice.tier.tierId, "alakazam_50");
  assert.deepEqual(invoice.credits, []);
  assert.equal(
    invoice.lines[0].description,
    "Alakazam monthly renewal"
  );
});

test("an unquoted receipt that is not a renewal, or an unreconciled total, is refused", () => {
  assert.throws(
    () =>
      projectAlakazamInvoice(
        storedInvoice({ tierId: null }),
        scope(),
        RECEIPT_ID
      ),
    /invoice tier is unavailable/u
  );
  assert.throws(
    () =>
      projectAlakazamInvoice(
        storedInvoice({ totalMinor: 2100 }),
        scope(),
        RECEIPT_ID
      ),
    /invoice total changed/u
  );
  assert.throws(
    () =>
      projectAlakazamInvoice(
        storedInvoice({
          kind: "renewal_payment",
          tierId: null,
          discountMinor: 500,
          subtotalMinor: 2500,
          netSubtotalMinor: 2000,
          totalMinor: 2000
        }),
        scope(),
        RECEIPT_ID
      ),
    /invoice total changed/u
  );
});

test("a missing receipt and a foreign actor both read as unavailable", () => {
  assert.throws(
    () =>
      projectAlakazamInvoice(null, scope(), RECEIPT_ID),
    (error) =>
      error.code === "invoice_unavailable" &&
      error.status === 404
  );
  assert.throws(
    () =>
      projectAlakazamInvoice(
        storedInvoice(),
        scope({ actorId: OTHER_CUSTOMER_ID }),
        RECEIPT_ID
      ),
    (error) =>
      error.code === "project_unavailable" &&
      error.status === 404
  );
});

test("a receipt bound to another project cannot be projected into this project", () => {
  assert.throws(
    () =>
      projectAlakazamInvoice(
        storedInvoice({
          projectId: "30000000-0000-4000-8000-000000000002"
        }),
        scope(),
        RECEIPT_ID
      ),
    /invoice binding changed/u
  );
});

test("the invoice route is matched only as an authenticated GET on the exact path", () => {
  assert.deepEqual(
    matchAlakazamBillingSurfaceRoute(
      "GET",
      `/api/v1/projects/${PROJECT_ID}/alakazam/invoices/${RECEIPT_ID}`
    ),
    {
      surface: "invoice",
      projectId: PROJECT_ID,
      receiptId: RECEIPT_ID
    }
  );
  assert.equal(
    matchAlakazamBillingSurfaceRoute(
      "POST",
      `/api/v1/projects/${PROJECT_ID}/alakazam/invoices/${RECEIPT_ID}`
    ),
    null
  );
  assert.equal(
    matchAlakazamBillingSurfaceRoute(
      "GET",
      `/api/v1/projects/${PROJECT_ID}/alakazam/invoices`
    ),
    null
  );
  assert.equal(
    matchAlakazamBillingSurfaceRoute(
      "GET",
      `/api/v1/projects/${PROJECT_ID}/alakazam/invoices/${RECEIPT_ID}/x`
    ),
    null
  );
});

test("the default hosted runtime keeps Alakazam invoice retrieval explicitly held", async () => {
  const held = createHeldHostedAlakazamBillingSurfaces();
  await assert.rejects(
    () =>
      held.getInvoice(
        { userId: CUSTOMER_ID },
        PROJECT_ID,
        RECEIPT_ID
      ),
    (error) =>
      error.code === "ALAKAZAM_INVOICE_HELD" &&
      error.status === 503
  );
  await assert.rejects(
    () => held.getInvoice(null, PROJECT_ID, RECEIPT_ID),
    (error) =>
      error.code === "AUTHENTICATION_REQUIRED" &&
      error.status === 401
  );
});

test("the composed invoice read is account-bound and reaches the repository with the signed-in identity only", async () => {
  const calls = [];
  const surfaces = boundary(async (input) => {
    calls.push(input);
    return storedInvoice();
  });
  const invoice = await surfaces.getInvoice(
    { userId: CUSTOMER_ID },
    PROJECT_ID,
    RECEIPT_ID
  );
  assert.equal(invoice.schema, ALAKAZAM_INVOICE_SCHEMA);
  assert.deepEqual(calls, [
    {
      tenantId: TENANT_ID,
      customerId: CUSTOMER_ID,
      actorId: CUSTOMER_ID,
      projectId: PROJECT_ID,
      receiptId: RECEIPT_ID
    }
  ]);
});

test("a signed-out reader, an invalid project, and an invalid receipt never reach the repository", async () => {
  let reached = 0;
  const surfaces = boundary(async () => {
    reached += 1;
    return storedInvoice();
  });
  await assert.rejects(
    () =>
      surfaces.getInvoice(null, PROJECT_ID, RECEIPT_ID),
    (error) => error.status === 401
  );
  await assert.rejects(
    () =>
      surfaces.getInvoice(
        { userId: CUSTOMER_ID },
        "not-a-project",
        RECEIPT_ID
      ),
    (error) => error.code === "INVALID_PROJECT_ID"
  );
  await assert.rejects(
    () =>
      surfaces.getInvoice(
        { userId: CUSTOMER_ID },
        PROJECT_ID,
        "not-a-receipt"
      ),
    (error) =>
      error.code === "INVALID_ALAKAZAM_RECEIPT_ID"
  );
  assert.equal(reached, 0);
});

test("a session that resolves to another customer or project is refused before the repository", async () => {
  let reached = 0;
  const surfaces = createHostedAlakazamBillingSurfaces({
    repository: {
      async readCustomerInvoice() {
        reached += 1;
        return storedInvoice();
      },
      async readCustomerBillingStates() {
        throw new Error("unused");
      }
    },
    account: {
      async read() {
        throw new Error("unused");
      }
    },
    async resolveSession({ projectId }) {
      return {
        tenantId: TENANT_ID,
        customerId: OTHER_CUSTOMER_ID,
        actorId: OTHER_CUSTOMER_ID,
        projectId
      };
    }
  });
  await assert.rejects(
    () =>
      surfaces.getInvoice(
        { userId: CUSTOMER_ID },
        PROJECT_ID,
        RECEIPT_ID
      ),
    (error) =>
      error.code === "project_unavailable" &&
      error.status === 404
  );
  assert.equal(reached, 0);
});

test("the invoice request accepts no query values", async () => {
  const surfaces = boundary(async () => storedInvoice());
  const route = matchAlakazamBillingSurfaceRoute(
    "GET",
    `/api/v1/projects/${PROJECT_ID}/alakazam/invoices/${RECEIPT_ID}`
  );
  const ok = await readAlakazamBillingSurface(
    surfaces,
    { userId: CUSTOMER_ID },
    route,
    new URL(
      `https://app.test/api/v1/projects/${PROJECT_ID}/alakazam/invoices/${RECEIPT_ID}`
    )
  );
  assert.equal(ok.receiptId, RECEIPT_ID);
  await assert.rejects(
    () =>
      readAlakazamBillingSurface(
        surfaces,
        { userId: CUSTOMER_ID },
        route,
        new URL(
          `https://app.test/api/v1/projects/${PROJECT_ID}/alakazam/invoices/${RECEIPT_ID}?format=pdf`
        )
      ),
    (error) =>
      error.code === "INVALID_ALAKAZAM_BILLING_QUERY" &&
      error.status === 400
  );
});

test("the derived invoice reference is stable, uppercase, and receipt-bound", () => {
  assert.equal(
    alakazamInvoiceNumber(RECEIPT_ID),
    alakazamInvoiceNumber(RECEIPT_ID)
  );
  assert.match(
    alakazamInvoiceNumber(RECEIPT_ID),
    /^SSAK-[0-9A-F]{32}$/u
  );
  assert.notEqual(
    alakazamInvoiceNumber(RECEIPT_ID),
    alakazamInvoiceNumber(
      "40000000-0000-4000-8000-000000000002"
    )
  );
});
