import assert from "node:assert/strict";
import test from "node:test";

import {
  createHostedCustomServicesCustomBuildHandoffOwner
} from "../custom-services-account-hosted.mjs";
import {
  CUSTOM_BUILD_HANDOFF_COMMAND_SCHEMA,
  CUSTOM_BUILD_HANDOFF_DOCUMENT_SCHEMA,
  CUSTOM_BUILD_HANDOFF_STATE_SCHEMA,
  createHeldCustomServicesCustomBuildHandoff,
  createPostgresCustomServicesCustomBuildHandoff
} from "../custom-services-custom-build-handoff-postgres.mjs";
import { canonicalJson, digest } from "../security.mjs";

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";
const PROJECT_ID = "20000000-0000-4000-8000-000000000001";
const CUSTOMER_ID = "30000000-0000-4000-8000-000000000001";
const JOB_ID = "40000000-0000-4000-8000-000000000001";
const CASE_ID = "50000000-0000-4000-8000-000000000001";
const COMPLETION_PACKAGE_ID = "60000000-0000-4000-8000-000000000001";
const OBLIGATION_ID = "70000000-0000-4000-8000-000000000001";
const FINAL_INVOICE_ID = "71000000-0000-4000-8000-000000000001";
const PAYMENT_RECEIPT_ID = "80000000-0000-4000-8000-000000000001";
const ZERO_CLEARANCE_ID = "81000000-0000-4000-8000-000000000001";
const DOCUMENT_ID = "90000000-0000-4000-8000-000000000001";
const HANDOFF_RECEIPT_ID = "a0000000-0000-4000-8000-000000000001";
const COMMAND_ROW_ID = "b0000000-0000-4000-8000-000000000001";
const OPERATOR_ID = "c0000000-0000-4000-8000-000000000001";
const COMPLETION_DIGEST = "1".repeat(64);
const OBLIGATION_DIGEST = "2".repeat(64);
const ZERO_CLEARANCE_DIGEST = "3".repeat(64);
const PAYMENT_CLEARANCE_DIGEST = "4".repeat(64);
const FINAL_INVOICE_DIGEST = "5".repeat(64);
const HANDOFF_DIGEST = "6".repeat(64);
const COMPLETION_AT = "2026-11-01T04:45:00.000Z";
const PAYMENT_CLEARED_AT = "2026-11-01T05:00:00.000Z";
const PAYMENT_PROVIDER_AT = "2026-11-01T04:59:00.000Z";
const ZERO_CLEARED_AT = "2026-11-01T05:01:00.000Z";
const HANDOFF_AT = "2026-11-01T05:30:00.000Z";
const WORKMANSHIP_ENDS_AT = "2026-12-01T05:30:00.000Z";
const COMMAND_ID = "handoff-command-0001";

function scope() {
  return {
    actorId: CUSTOMER_ID,
    customerId: CUSTOMER_ID,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID
  };
}

function input(overrides = {}) {
  return {
    commandId: COMMAND_ID,
    organizationId: ORGANIZATION_ID,
    expectedCompletionPackageDigest: COMPLETION_DIGEST,
    expectedFinalObligationDigest: OBLIGATION_DIGEST,
    customerSummary:
      "Your completed website and the delivery notes below are ready.",
    deliveryManifest: [
      {
        label: "Production website",
        description: "The reviewed public website and its launch-ready files."
      },
      {
        label: "Care notes",
        description: "Plain-language maintenance and support instructions."
      }
    ],
    ...overrides
  };
}

function cloneState(value) {
  return structuredClone(value);
}

function resultRows(value) {
  const selected = value === null || value === undefined
    ? []
    : Array.isArray(value)
      ? value
      : [value];
  // node-postgres returns detached row snapshots. This clone is deliberate:
  // later harness mutations cannot retroactively alter an earlier SELECT.
  const snapshots = structuredClone(selected);
  return { rows: snapshots, rowCount: snapshots.length };
}

function createHarness({
  clearance = "positive",
  completionPresent = true,
  documentManage = true,
  jobManage = true,
  paymentReconcile = false,
  unsettledAttempt = false,
  unsettledEvent = false,
  runningReconciliationCommand = false,
  workmanshipEndsAt = WORKMANSHIP_ENDS_AT,
  receiptRace = false
} = {}) {
  const state = {
    clearance,
    completionPresent,
    documentManage,
    jobManage,
    paymentReconcile,
    unsettledAttempt,
    unsettledEvent,
    runningReconciliationCommand,
    workmanshipEndsAt,
    receiptRace,
    commands: [],
    document: null,
    payload: null,
    handoff: null,
    transactions: []
  };

  function contextRow(selected) {
    if (!selected.completionPresent) return null;
    const positive = selected.clearance === "positive";
    const zero = selected.clearance === "zero";
    return {
      organization_id: ORGANIZATION_ID,
      project_id: PROJECT_ID,
      case_id: CASE_ID,
      customer_user_id: CUSTOMER_ID,
      job_id: JOB_ID,
      obligation_id: OBLIGATION_ID,
      obligation_digest: OBLIGATION_DIGEST,
      completion_package_id: COMPLETION_PACKAGE_ID,
      completion_package_digest: COMPLETION_DIGEST,
      completion_prepared_at: COMPLETION_AT,
      final_due_minor: positive || selected.clearance === "unpaid"
        ? "32500"
        : "0",
      currency: "USD",
      workmanship_correction_days: 30,
      final_payment_receipt_id: positive ? PAYMENT_RECEIPT_ID : null,
      payment_obligation_digest: positive ? OBLIGATION_DIGEST : null,
      payment_completion_package_digest: positive
        ? COMPLETION_DIGEST
        : null,
      payment_clearance_digest: positive ? PAYMENT_CLEARANCE_DIGEST : null,
      final_payment_provider_paid_at: positive ? PAYMENT_PROVIDER_AT : null,
      final_payment_cleared_at: positive ? PAYMENT_CLEARED_AT : null,
      final_payment_subtotal_minor: positive ? "32500" : null,
      final_payment_tax_minor: positive ? "2145" : null,
      final_payment_total_minor: positive ? "34645" : null,
      final_payment_currency: positive ? "USD" : null,
      zero_balance_clearance_id: zero ? ZERO_CLEARANCE_ID : null,
      clearance_obligation_digest: zero ? OBLIGATION_DIGEST : null,
      clearance_completion_package_digest: zero
        ? COMPLETION_DIGEST
        : null,
      zero_balance_clearance_digest: zero ? ZERO_CLEARANCE_DIGEST : null,
      zero_balance_clearance_reason: zero
        ? "accepted_quote_has_no_final_balance"
        : null,
      zero_balance_cleared_at: zero ? ZERO_CLEARED_AT : null,
      final_invoice_id: positive ? FINAL_INVOICE_ID : null,
      final_invoice_number: positive
        ? "SSCB-FINAL-71000000000040008000000000000001"
        : null,
      final_invoice_digest: positive ? FINAL_INVOICE_DIGEST : null,
      handoff_receipt_id: selected.handoff?.id ?? null,
      handoff_digest: selected.handoff?.handoff_digest ?? null,
      handoff_document_id: selected.handoff?.document_id ?? null,
      handoff_command_id: selected.handoff?.command_id ?? null,
      handoff_request_digest: selected.handoff?.request_digest ?? null,
      handoff_completion_package_digest:
        selected.handoff?.completion_package_digest ?? null,
      handoff_obligation_digest:
        selected.handoff?.final_obligation_digest ?? null,
      handoff_final_payment_receipt_id:
        selected.handoff?.final_payment_receipt_id ?? null,
      handoff_zero_balance_clearance_id:
        selected.handoff?.zero_balance_clearance_id ?? null,
      handoff_clearance_kind:
        selected.handoff?.financial_clearance_kind ?? null,
      handoff_clearance_digest:
        selected.handoff?.financial_clearance_digest ?? null,
      handoff_financial_cleared_at:
        selected.handoff?.financial_cleared_at ?? null,
      handoff_customer_summary: selected.handoff?.customer_summary ?? null,
      handoff_delivery_manifest: selected.handoff?.delivery_manifest ?? null,
      handoff_document_content_digest:
        selected.handoff?.document_content_digest ?? null,
      handoff_document_byte_count:
        selected.handoff?.document_byte_count ?? null,
      handoff_document_media_type:
        selected.handoff?.document_media_type ?? null,
      handed_off_at: selected.handoff?.handed_off_at ?? null,
      workmanship_starts_at:
        selected.handoff?.workmanship_starts_at ?? null,
      workmanship_ends_at: selected.handoff?.workmanship_ends_at ?? null,
      handoff_object_key: selected.document?.object_key ?? null,
      handoff_content_digest: selected.document?.content_digest ?? null,
      handoff_media_type: selected.document?.media_type ?? null,
      handoff_byte_count: selected.document?.byte_count ?? null,
      handoff_payload: selected.payload,
      has_unsettled_attempt: selected.unsettledAttempt,
      has_unsettled_event: selected.unsettledEvent,
      has_running_reconciliation_command:
        selected.runningReconciliationCommand
    };
  }

  function replaceState(draft) {
    for (const key of Object.keys(state)) {
      if (key !== "transactions") delete state[key];
    }
    for (const [key, value] of Object.entries(draft)) {
      if (key !== "transactions") state[key] = value;
    }
  }

  const authority = {
    async service(context, work) {
      const draft = cloneState(state);
      const transaction = { context: structuredClone(context), labels: [], queries: [] };
      state.transactions.push(transaction);

      function record(label, text, values) {
        transaction.labels.push(label);
        transaction.queries.push({ label, text, values: structuredClone(values ?? []) });
      }

      const client = {
        async query(text, values = []) {
          if (text.includes("/* handoff:readiness */")) {
            record("readiness", text, values);
            return resultRows({
              runtime_contract: "canonical-ss-v47-custom-build-handoff"
            });
          }
          if (text.includes("/* handoff:discover */")) {
            record("discover", text, values);
            return resultRows(
              draft.completionPresent &&
                values[0] === ORGANIZATION_ID &&
                values[1] === JOB_ID
                ? { job_id: JOB_ID }
                : null
            );
          }
          if (text.includes("/* handoff:lock */")) {
            record("advisory lock", text, values);
            assert.deepEqual(values, [`ss-custom-build-h1m:${JOB_ID}`]);
            return resultRows({ locked: null });
          }
          if (text.includes("/* handoff:command */")) {
            record("command", text, values);
            return resultRows(draft.commands.find((command) =>
              command.principal_id === values[0] &&
              command.route_key === values[1] &&
              command.idempotency_key === values[2]
            ) ?? null);
          }
          if (text.includes("/* handoff:capability */")) {
            record("capability", text, values);
            return resultRows({
              job_manage: draft.jobManage,
              document_manage: draft.documentManage
            });
          }
          if (text.includes("/* handoff:command-insert */")) {
            record("command insert", text, values);
            draft.commands.push({
              id: values[0],
              organization_id: values[1],
              principal_id: values[2],
              route_key: values[3],
              idempotency_key: values[4],
              request_digest: values[5],
              state: "running",
              response_status: null,
              response_body: null,
              resource_id: null
            });
            return resultRows(null);
          }
          if (text.includes("/* handoff:customer-read */")) {
            record("customer read", text, values);
            return resultRows(
              values[0] === ORGANIZATION_ID &&
                values[1] === PROJECT_ID &&
                values[2] === CUSTOMER_ID
                ? contextRow(draft)
                : null
            );
          }
          if (text.includes("/* handoff:document-read */")) {
            record("document read", text, values);
            return resultRows(
              values[0] === ORGANIZATION_ID &&
                values[1] === PROJECT_ID &&
                values[2] === CUSTOMER_ID &&
                draft.handoff?.document_id === values[3]
                ? contextRow(draft)
                : null
            );
          }
          if (text.includes("/* handoff:owner-read */")) {
            record("owner read", text, values);
            return resultRows(
              values[0] === ORGANIZATION_ID && values[1] === JOB_ID
                ? contextRow(draft)
                : null
            );
          }
          if (text.includes("/* handoff:context */")) {
            record("context", text, values);
            return resultRows(
              values[0] === ORGANIZATION_ID && values[1] === JOB_ID
                ? contextRow(draft)
                : null
            );
          }
          if (text.includes("/* handoff:create */")) {
            record("atomic handoff create", text, values);
            const manifest = JSON.parse(values[6]);
            if (draft.handoff !== null) {
              if (
                draft.handoff.command_id === values[1] &&
                draft.handoff.customer_summary === values[5] &&
                JSON.stringify(draft.handoff.delivery_manifest) ===
                  JSON.stringify(manifest)
              ) {
                return resultRows({
                  receipt_id: draft.handoff.id,
                  document_id: draft.handoff.document_id,
                  handoff_digest: draft.handoff.handoff_digest,
                  handed_off_at: draft.handoff.handed_off_at,
                  workmanship_starts_at:
                    draft.handoff.workmanship_starts_at,
                  workmanship_ends_at: draft.handoff.workmanship_ends_at
                });
              }
              const error = new Error("immutable handoff command conflicts");
              error.code = "23505";
              error.constraint =
                "service_custom_build_handoff_receipts_job_id_key";
              throw error;
            }
            if (draft.receiptRace) {
              const error = new Error("duplicate handoff receipt race");
              error.code = "23505";
              error.constraint =
                "service_custom_build_handoff_receipts_job_id_key";
              throw error;
            }
            const positive = draft.clearance === "positive";
            const rawPayload = {
              completion: {
                packageDigest: COMPLETION_DIGEST,
                packageId: COMPLETION_PACKAGE_ID
              },
              customerSummary: values[5],
              deliveryManifest: manifest.items,
              finalObligation: {
                obligationDigest: OBLIGATION_DIGEST,
                obligationId: OBLIGATION_ID
              },
              financialClearance: positive
                ? {
                    clearedAt: PAYMENT_CLEARED_AT,
                    kind: "provider_confirmed_final_payment",
                    referenceId: PAYMENT_RECEIPT_ID
                  }
                : {
                    clearedAt: ZERO_CLEARED_AT,
                    kind: "zero_balance_clearance",
                    referenceId: ZERO_CLEARANCE_ID
                  },
              handoff: {
                receiptId: HANDOFF_RECEIPT_ID,
                documentId: DOCUMENT_ID,
                handedOffAt: HANDOFF_AT,
                workmanship: {
                  coverage: "[start,end)",
                  termDays: 30,
                  startsAt: HANDOFF_AT,
                  endsAt: draft.workmanshipEndsAt
                }
              },
              jobId: JOB_ID,
              projectId: PROJECT_ID,
              schema: CUSTOM_BUILD_HANDOFF_DOCUMENT_SCHEMA,
              state: "handed_off"
            };
            const payload = Buffer.from(canonicalJson(rawPayload), "utf8");
            const contentDigest = digest(payload);
            draft.document = {
              id: DOCUMENT_ID,
              organization_id: ORGANIZATION_ID,
              project_id: PROJECT_ID,
              case_id: CASE_ID,
              object_key:
                `service-documents/${ORGANIZATION_ID}/${PROJECT_ID}` +
                `/custom-build-jobs/${JOB_ID}/handoff/${DOCUMENT_ID}.json`,
              content_digest: contentDigest,
              media_type: "application/json",
              byte_count: payload.byteLength,
              created_by_operator_user_id: OPERATOR_ID,
              created_at: HANDOFF_AT
            };
            draft.payload = payload;
            draft.handoff = {
              id: HANDOFF_RECEIPT_ID,
              handoff_digest: HANDOFF_DIGEST,
              organization_id: ORGANIZATION_ID,
              project_id: PROJECT_ID,
              case_id: CASE_ID,
              customer_user_id: CUSTOMER_ID,
              job_id: JOB_ID,
              completion_package_id: COMPLETION_PACKAGE_ID,
              final_obligation_id: OBLIGATION_ID,
              final_payment_receipt_id: positive ? PAYMENT_RECEIPT_ID : null,
              zero_balance_clearance_id: positive ? null : ZERO_CLEARANCE_ID,
              document_id: DOCUMENT_ID,
              command_id: values[1],
              request_digest: "7".repeat(64),
              completion_package_digest: COMPLETION_DIGEST,
              final_obligation_digest: OBLIGATION_DIGEST,
              financial_clearance_kind: positive
                ? "provider_confirmed_final_payment"
                : "zero_balance_clearance",
              financial_clearance_digest: positive
                ? PAYMENT_CLEARANCE_DIGEST
                : ZERO_CLEARANCE_DIGEST,
              financial_cleared_at: positive
                ? PAYMENT_CLEARED_AT
                : ZERO_CLEARED_AT,
              customer_summary: values[5],
              delivery_manifest: manifest,
              document_content_digest: contentDigest,
              document_byte_count: payload.byteLength,
              document_media_type: "application/json",
              handed_off_at: HANDOFF_AT,
              workmanship_starts_at: HANDOFF_AT,
              workmanship_ends_at: draft.workmanshipEndsAt
            };
            return resultRows({
              receipt_id: HANDOFF_RECEIPT_ID,
              document_id: DOCUMENT_ID,
              handoff_digest: HANDOFF_DIGEST,
              handed_off_at: HANDOFF_AT,
              workmanship_starts_at: HANDOFF_AT,
              workmanship_ends_at: draft.workmanshipEndsAt
            });
          }
          if (text.includes("/* handoff:created-context */")) {
            record("created context", text, values);
            return resultRows(
              values[0] === ORGANIZATION_ID && values[1] === JOB_ID
                ? contextRow(draft)
                : null
            );
          }
          if (text.includes("/* handoff:command-complete */")) {
            record("command complete", text, values);
            const command = draft.commands.find((candidate) =>
              candidate.principal_id === values[0] &&
              candidate.route_key === values[1] &&
              candidate.idempotency_key === values[2] &&
              candidate.state === "running"
            );
            if (!command) return resultRows(null);
            command.state = "completed";
            command.response_status = 201;
            command.response_body = JSON.parse(values[3]);
            command.resource_id = values[4];
            return { rows: [], rowCount: 1 };
          }
          assert.fail(`Unexpected handoff query: ${text}`);
        }
      };

      try {
        const result = await work(client);
        replaceState(draft);
        return result;
      } catch (error) {
        throw error;
      }
    }
  };

  let sequence = 0;
  const ids = {
    next(purpose) {
      sequence += 1;
      const selected = {
        custom_build_handoff_command: COMMAND_ROW_ID,
        custom_build_handoff_document: DOCUMENT_ID,
        custom_build_handoff_receipt: HANDOFF_RECEIPT_ID
      }[purpose];
      assert.ok(selected, `unexpected handoff ID purpose ${purpose}`);
      // A fresh command after a rollback still needs a unique harness UUID.
      if (sequence <= 3) return selected;
      return `${String(sequence).padStart(8, "d").slice(0, 8)}-0000-4000-8000-000000000001`;
    }
  };
  const service = createPostgresCustomServicesCustomBuildHandoff({
    authority,
    ids
  });
  return { service, state };
}

function assertOrdered(labels, expected) {
  let previous = -1;
  for (const label of expected) {
    const index = labels.indexOf(label);
    assert.ok(index > previous, `${label} must follow ${expected[previous] ?? "start"}`);
    previous = index;
  }
}

test("positive final receipt creates one canonical handoff under the shared lock", async () => {
  const { service, state } = createHarness();
  const result = await service.createHandoff(
    { userId: OPERATOR_ID },
    JOB_ID,
    input()
  );

  assert.equal(result.schema, CUSTOM_BUILD_HANDOFF_COMMAND_SCHEMA);
  assert.equal(result.state, "handed_off");
  assert.equal(
    result.financialClearance.kind,
    "provider_confirmed_final_payment"
  );
  assert.equal(result.financialClearance.referenceId, PAYMENT_RECEIPT_ID);
  assert.deepEqual(result.workmanship, {
    coverage: "[start,end)",
    termDays: 30,
    startsAt: HANDOFF_AT,
    endsAt: WORKMANSHIP_ENDS_AT
  });
  assert.equal(state.handoff.final_payment_receipt_id, PAYMENT_RECEIPT_ID);
  assert.equal(state.handoff.zero_balance_clearance_id, null);
  assert.equal(state.document.byte_count, state.payload.byteLength);

  const transaction = state.transactions.at(-1);
  assertOrdered(transaction.labels, [
    "discover",
    "advisory lock",
    "command",
    "capability",
    "command insert",
    "context",
    "atomic handoff create",
    "created context",
    "command complete"
  ]);
  assert.equal(
    transaction.labels.filter((label) =>
      label === "atomic handoff create"
    ).length,
    1
  );

  const customer = await service.readCustomer(scope());
  assert.equal(customer.schema, CUSTOM_BUILD_HANDOFF_STATE_SCHEMA);
  assert.equal(customer.state, "handed_off");
  assert.equal(customer.handoff.documentId, DOCUMENT_ID);
  assert.equal(customer.action.handoffAvailable, false);
  const customerSerialized = JSON.stringify(customer);
  assert.doesNotMatch(customerSerialized, /cus_/u);
  assert.doesNotMatch(customerSerialized, /stripe/u);
  assert.doesNotMatch(customerSerialized, new RegExp(CUSTOMER_ID, "u"));
  assert.doesNotMatch(customerSerialized, new RegExp(OPERATOR_ID, "u"));

  const document = await service.readCustomerDocument(scope(), DOCUMENT_ID);
  assert.equal(document.schema, CUSTOM_BUILD_HANDOFF_DOCUMENT_SCHEMA);
  assert.equal(document.payload.state, "handed_off");
  assert.equal(document.payload.handoff.workmanship.termDays, 30);
  assert.deepEqual(document.payload.deliveryManifest, input().deliveryManifest);
  const customerDocumentBytes = Buffer.from(
    canonicalJson(document.payload),
    "utf8"
  );
  assert.equal(document.byteCount, customerDocumentBytes.byteLength);
  assert.equal(document.contentDigest, digest(customerDocumentBytes));
  assert.deepEqual(customerDocumentBytes, Buffer.from(state.payload));
  const documentSerialized = JSON.stringify(document);
  assert.doesNotMatch(documentSerialized, new RegExp(CUSTOMER_ID, "u"));
  assert.doesNotMatch(documentSerialized, new RegExp(OPERATOR_ID, "u"));
  assert.doesNotMatch(documentSerialized, new RegExp(CASE_ID, "u"));
  assert.doesNotMatch(documentSerialized, new RegExp(ORGANIZATION_ID, "u"));
  assert.doesNotMatch(documentSerialized, /(?:cs|pi|ch|cus|evt)_[A-Za-z0-9_]+/u);

  const owner = await service.readOwner(
    { userId: OPERATOR_ID },
    JOB_ID,
    ORGANIZATION_ID
  );
  assert.equal(owner.state, "handed_off");
  assert.equal(owner.organizationId, ORGANIZATION_ID);
  assert.equal(owner.action.handoffAvailable, false);
});

test("zero-balance clearance creates handoff without a payment receipt", async () => {
  const { service, state } = createHarness({ clearance: "zero" });
  const result = await service.createHandoff(
    { userId: OPERATOR_ID },
    JOB_ID,
    input()
  );

  assert.equal(result.state, "handed_off");
  assert.deepEqual(result.financialClearance, {
    kind: "zero_balance_clearance",
    referenceId: ZERO_CLEARANCE_ID,
    clearedAt: ZERO_CLEARED_AT
  });
  assert.equal(state.handoff.final_payment_receipt_id, null);
  assert.equal(state.handoff.zero_balance_clearance_id, ZERO_CLEARANCE_ID);
  assert.doesNotMatch(JSON.stringify(result), /stripe|provider/iu);
});

test("exact command replay returns the immutable result and digest drift conflicts", async () => {
  const { service, state } = createHarness();
  const first = await service.createHandoff(
    { userId: OPERATOR_ID },
    JOB_ID,
    input()
  );
  const replay = await service.createHandoff(
    { userId: OPERATOR_ID },
    JOB_ID,
    input()
  );
  assert.deepEqual(replay, first);
  assert.equal(
    state.transactions.at(-1).labels.includes("atomic handoff create"),
    false
  );

  state.commands = [];
  const durableReplay = await service.createHandoff(
    { userId: OPERATOR_ID },
    JOB_ID,
    input()
  );
  assert.deepEqual(durableReplay, first);
  assert.equal(
    state.transactions.at(-1).labels.includes("atomic handoff create"),
    true,
    "the immutable receipt remains the replay authority after cache expiry"
  );

  await assert.rejects(
    service.createHandoff(
      { userId: OPERATOR_ID },
      JOB_ID,
      input({
        customerSummary:
          "A different bounded customer summary cannot reuse this command."
      })
    ),
    (error) => error.code === "CUSTOM_BUILD_HANDOFF_COMMAND_CONFLICT" &&
      error.status === 409
  );

  state.commands = [];
  await assert.rejects(
    service.createHandoff(
      { userId: OPERATOR_ID },
      JOB_ID,
      input({
        customerSummary:
          "A changed request cannot reuse the durable receipt command either."
      })
    ),
    (error) => error.code === "CUSTOM_BUILD_HANDOFF_CHANGED" &&
      error.status === 409
  );
});

test("stale authority, uncleared payment, and unsettled effects fail closed", async () => {
  const stale = createHarness();
  await assert.rejects(
    stale.service.createHandoff(
      { userId: OPERATOR_ID },
      JOB_ID,
      input({ expectedFinalObligationDigest: "f".repeat(64) })
    ),
    (error) => error.code === "CUSTOM_BUILD_HANDOFF_CHANGED" &&
      error.status === 409
  );
  assert.equal(stale.state.commands.length, 0, "failed transaction rolls back command");

  for (const mode of [
    "unsettledAttempt",
    "unsettledEvent",
    "runningReconciliationCommand"
  ]) {
    const harness = createHarness({ [mode]: true });
    await assert.rejects(
      harness.service.createHandoff(
        { userId: OPERATOR_ID },
        JOB_ID,
        input()
      ),
      (error) =>
        error.code === "CUSTOM_BUILD_HANDOFF_PAYMENT_RECONCILIATION_REQUIRED" &&
        error.status === 409
    );
    assert.equal(harness.state.handoff, null);
    assert.equal(harness.state.commands.length, 0);
  }

  const unpaid = createHarness({ clearance: "unpaid" });
  await assert.rejects(
    unpaid.service.createHandoff(
      { userId: OPERATOR_ID },
      JOB_ID,
      input()
    ),
    (error) => error.code === "CUSTOM_BUILD_HANDOFF_NOT_CLEARED" &&
      error.status === 409
  );
  assert.equal(unpaid.state.handoff, null);

  const dstCalendarDrift = createHarness({
    workmanshipEndsAt: "2026-12-01T06:30:00.000Z"
  });
  await assert.rejects(
    dstCalendarDrift.service.createHandoff(
      { userId: OPERATOR_ID },
      JOB_ID,
      input()
    ),
    (error) => error.code === "CUSTOM_BUILD_HANDOFF_REPOSITORY_CONFLICT" &&
      error.status === 500
  );
  assert.equal(dstCalendarDrift.state.handoff, null);
});

test("duplicate commands and a snapshot-safe receipt race cannot create a second handoff", async () => {
  const duplicate = createHarness();
  await duplicate.service.createHandoff(
    { userId: OPERATOR_ID },
    JOB_ID,
    input()
  );
  await assert.rejects(
    duplicate.service.createHandoff(
      { userId: OPERATOR_ID },
      JOB_ID,
      input({ commandId: "handoff-command-0002" })
    ),
    (error) => error.code === "CUSTOM_BUILD_HANDOFF_CHANGED" &&
      error.status === 409
  );
  assert.equal(duplicate.state.commands.length, 1);

  const raced = createHarness({ receiptRace: true });
  await assert.rejects(
    raced.service.createHandoff(
      { userId: OPERATOR_ID },
      JOB_ID,
      input()
    ),
    (error) => error.code === "CUSTOM_BUILD_HANDOFF_CHANGED" &&
      error.status === 409
  );
  // The harness returns detached SELECT snapshots and commits only successful
  // transactions, matching PostgreSQL semantics for the adversarial race.
  assert.equal(raced.state.document, null);
  assert.equal(raced.state.payload, null);
  assert.equal(raced.state.handoff, null);
  assert.equal(raced.state.commands.length, 0);
});

test("payload, path, digest, and clearance corruption are rejected on read", async () => {
  const payloadHarness = createHarness();
  await payloadHarness.service.createHandoff(
    { userId: OPERATOR_ID },
    JOB_ID,
    input()
  );
  payloadHarness.state.payload = Buffer.from("{}", "utf8");
  await assert.rejects(
    payloadHarness.service.readCustomerDocument(scope(), DOCUMENT_ID),
    (error) => error.code === "CUSTOM_BUILD_HANDOFF_REPOSITORY_CONFLICT" &&
      error.status === 500
  );

  const pathHarness = createHarness();
  await pathHarness.service.createHandoff(
    { userId: OPERATOR_ID },
    JOB_ID,
    input()
  );
  pathHarness.state.document.object_key =
    `service-documents/${ORGANIZATION_ID}/${PROJECT_ID}/wrong.json`;
  await assert.rejects(
    pathHarness.service.readCustomer(scope()),
    (error) => error.code === "CUSTOM_BUILD_HANDOFF_REPOSITORY_CONFLICT" &&
      error.status === 500
  );

  const clearanceHarness = createHarness();
  await clearanceHarness.service.createHandoff(
    { userId: OPERATOR_ID },
    JOB_ID,
    input()
  );
  clearanceHarness.state.handoff.final_payment_receipt_id = null;
  clearanceHarness.state.handoff.zero_balance_clearance_id = ZERO_CLEARANCE_ID;
  await assert.rejects(
    clearanceHarness.service.readCustomer(scope()),
    (error) => error.code === "CUSTOM_BUILD_HANDOFF_REPOSITORY_CONFLICT" &&
      error.status === 500
  );
});

test("strict allowlists and credential-safe bounds reject unsafe handoff input", async () => {
  const { service } = createHarness();
  const attempts = [
    { ...input(), extra: true },
    input({ commandId: " handoff-padded-command " }),
    input({ commandId: "handoff-secret-command" }),
    input({
      customerSummary:
        "Use the password swordfish to open the customer's administration."
    }),
    input({
      customerSummary:
        "Send Bearer abcdefghijklmnopqrstuvwxyz with the delivery notes."
    }),
    input({
      customerSummary:
        "Open the delivery page with ?token=customer-secret-value."
    }),
    input({
      customerSummary:
        "The retained payment reference is cs_test_customer_leak_123456."
    }),
    input({
      deliveryManifest: [{
        label: "Admin",
        description: "Access token abcdefghijklmnopqrstuvwxyz"
      }]
    }),
    input({
      deliveryManifest: [{
        label: "Receipt evt_test_customer_leak_123456",
        description: "A customer delivery item without credentials."
      }]
    }),
    input({
      deliveryManifest: [
        { label: "Duplicate", description: "First delivered item." },
        { label: "duplicate", description: "Second delivered item." }
      ]
    }),
    input({
      deliveryManifest: Array.from({ length: 41 }, (_, index) => ({
        label: `Item ${index}`,
        description: "A bounded delivered item."
      }))
    })
  ];
  for (const value of attempts) {
    await assert.rejects(
      service.createHandoff({ userId: OPERATOR_ID }, JOB_ID, value),
      (error) => error.code === "INVALID_CUSTOM_BUILD_HANDOFF_INPUT" &&
        [400, 413].includes(error.status)
    );
  }
});

test("owner readiness and handoff require independent job and document capabilities", async () => {
  const exact = createHarness({
    documentManage: true,
    jobManage: true,
    paymentReconcile: false
  });
  const exactOwner = createHostedCustomServicesCustomBuildHandoffOwner({
    customBuildHandoff: exact.service
  });
  const readiness = await exactOwner.readOwnerState(
    { userId: OPERATOR_ID },
    JOB_ID,
    ORGANIZATION_ID
  );
  assert.equal(
    readiness.schema,
    "sitesourcery.custom-build-handoff-owner-readiness/v1"
  );
  assert.equal(readiness.state, "handoff_available");
  assert.equal(readiness.action.handoffAvailable, true);
  assert.equal(exact.state.paymentReconcile, false);
  assert.doesNotMatch(
    JSON.stringify(readiness),
    /(?:cs|pi|ch|cus|evt)_[A-Za-z0-9_]+|checkout|payment|provider|attempt|event|reconciliation|referenceId|receiptId/u
  );
  const created = await exactOwner.createHandoff(
    { userId: OPERATOR_ID },
    JOB_ID,
    input()
  );
  assert.equal(created.state, "handed_off");

  const deniedCapabilities = [
    {
      documentManage: false,
      jobManage: false,
      paymentReconcile: false
    },
    {
      documentManage: true,
      jobManage: false,
      paymentReconcile: false
    },
    {
      documentManage: false,
      jobManage: true,
      paymentReconcile: false
    },
    {
      documentManage: false,
      jobManage: false,
      paymentReconcile: true
    },
    {
      documentManage: false,
      jobManage: true,
      paymentReconcile: true
    },
    {
      documentManage: true,
      jobManage: false,
      paymentReconcile: true
    }
  ];
  for (const capabilities of deniedCapabilities) {
    const denied = createHarness(capabilities);
    const deniedOwner = createHostedCustomServicesCustomBuildHandoffOwner({
      customBuildHandoff: denied.service
    });
    await assert.rejects(
      deniedOwner.readOwnerState(
        { userId: OPERATOR_ID },
        JOB_ID,
        ORGANIZATION_ID
      ),
      (error) => error.code === "OPERATOR_ACCESS_REQUIRED" &&
        error.status === 403
    );
    await assert.rejects(
      deniedOwner.createHandoff(
        { userId: OPERATOR_ID },
        JOB_ID,
        input()
      ),
      (error) => error.code === "OPERATOR_ACCESS_REQUIRED" &&
        error.status === 403
    );
    assert.deepEqual(
      denied.state.transactions.at(-1).labels.slice(0, 4),
      ["discover", "advisory lock", "command", "capability"]
    );
  }

  const allThree = createHarness({
    documentManage: true,
    jobManage: true,
    paymentReconcile: true
  });
  const allThreeOwner = createHostedCustomServicesCustomBuildHandoffOwner({
    customBuildHandoff: allThree.service
  });
  assert.equal(
    (await allThreeOwner.readOwnerState(
      { userId: OPERATOR_ID },
      JOB_ID,
      ORGANIZATION_ID
    )).state,
    "handoff_available"
  );
  assert.equal(
    (await allThreeOwner.createHandoff(
      { userId: OPERATOR_ID },
      JOB_ID,
      input()
    )).state,
    "handed_off"
  );
});

test("customer scope, held mode, readiness, and pre-completion state are bounded", async () => {
  const empty = createHarness({ completionPresent: false });
  const customer = await empty.service.readCustomer(scope());
  assert.equal(customer.state, "completion_required");
  assert.equal(customer.jobId, null);

  await assert.rejects(
    empty.service.readCustomer({ ...scope(), actorId: OPERATOR_ID }),
    (error) => error.code === "CUSTOM_BUILD_HANDOFF_UNAVAILABLE" &&
      error.status === 404
  );

  const ready = createHarness();
  assert.deepEqual(await ready.service.readiness(), {
    schema: "sitesourcery.custom-build-handoff-readiness/v1",
    ready: true,
    state: "ready",
    runtimeContract: "canonical-ss-v47-custom-build-handoff"
  });

  const held = createHeldCustomServicesCustomBuildHandoff();
  assert.deepEqual(await held.readiness(), {
    schema: "sitesourcery.custom-build-handoff-readiness/v1",
    ready: false,
    state: "held"
  });
  await assert.rejects(
    held.readCustomer(scope()),
    (error) => error.code === "CUSTOM_BUILD_HANDOFF_HELD" && error.status === 503
  );
});
