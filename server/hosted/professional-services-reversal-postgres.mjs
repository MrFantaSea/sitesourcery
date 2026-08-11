import {
  PROFESSIONAL_REVERSAL_DECISION_SCHEMA,
  exactProfessionalPayment
} from "../commerce-v2/professional-services-reversal.mjs";
import { deepFreeze, invariant } from "../commerce-v2/canonical.mjs";
import { HostedError } from "./errors.mjs";

export const PROFESSIONAL_REVERSAL_RESULT_SCHEMA =
  "sitesourcery.professional-services-reversal-result/v1";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PAYMENT_INTENT_ID = /^pi_[A-Za-z0-9_]+$/u;
const DATABASE_CODES = new Set([
  "22001",
  "22P02",
  "23502",
  "23503",
  "23505",
  "23514",
  "40001",
  "40P01",
  "42501",
  "55000"
]);

function exactKeys(value, expected, field) {
  invariant(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...expected].sort()),
    "PROFESSIONAL_REVERSAL_REPOSITORY_CONFLICT",
    `${field} is invalid`,
    { status: 500 }
  );
  return value;
}

function exactUuid(value, field) {
  invariant(
    typeof value === "string" && UUID.test(value),
    "PROFESSIONAL_REVERSAL_REPOSITORY_CONFLICT",
    `${field} is invalid`,
    { status: 500 }
  );
  return value;
}

function rows(result, field) {
  invariant(
    result &&
      Array.isArray(result.rows) &&
      Number.isSafeInteger(result.rowCount) &&
      result.rows.length === result.rowCount,
    "PROFESSIONAL_REVERSAL_REPOSITORY_CONFLICT",
    `${field} is invalid`,
    { status: 500 }
  );
  return result.rows;
}

function one(result, field, { optional = false } = {}) {
  const selected = rows(result, field);
  invariant(
    selected.length <= 1,
    "PROFESSIONAL_REVERSAL_REPOSITORY_CONFLICT",
    `${field} conflicts`,
    { status: 500 }
  );
  invariant(
    optional || selected.length === 1,
    "PROFESSIONAL_REVERSAL_REPOSITORY_CONFLICT",
    `${field} is unavailable`,
    { status: 500 }
  );
  return selected[0] ?? null;
}

function exactInteger(value, field, minimum = 0) {
  const selected = Number(value);
  invariant(
    Number.isSafeInteger(selected) && selected >= minimum,
    "PROFESSIONAL_REVERSAL_REPOSITORY_CONFLICT",
    `${field} is invalid`,
    { status: 500 }
  );
  return selected;
}

function paymentFromRow(row) {
  exactKeys(
    row,
    [
      "credit_state",
      "currency",
      "current_severity",
      "current_state",
      "customer_user_id",
      "lifecycle_revision",
      "organization_id",
      "payment_intent_id",
      "payment_purpose",
      "project_id",
      "quote_state",
      "receipt_id",
      "total_minor"
    ],
    "professionalPaymentRow"
  );
  return exactProfessionalPayment({
    paymentPurpose: row.payment_purpose,
    receiptId: row.receipt_id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    customerId: row.customer_user_id,
    paymentIntentId: row.payment_intent_id,
    totalMinor: exactInteger(row.total_minor, "professionalPaymentRow.totalMinor", 1),
    currency: row.currency,
    currentState: row.current_state,
    currentSeverity: exactInteger(
      row.current_severity,
      "professionalPaymentRow.currentSeverity"
    ),
    lifecycleRevision: exactInteger(
      row.lifecycle_revision,
      "professionalPaymentRow.lifecycleRevision"
    ),
    creditState: row.credit_state,
    quoteState: row.quote_state
  });
}

function paymentSourceFromRow(row) {
  exactKeys(
    row,
    [
      "customer_user_id",
      "organization_id",
      "payment_intent_id",
      "payment_purpose",
      "project_id",
      "receipt_id"
    ],
    "professionalPaymentSourceRow"
  );
  return Object.freeze({
    paymentPurpose: row.payment_purpose,
    receiptId: exactUuid(row.receipt_id, "professionalPaymentSourceRow.receiptId"),
    organizationId: exactUuid(
      row.organization_id,
      "professionalPaymentSourceRow.organizationId"
    ),
    projectId: exactUuid(row.project_id, "professionalPaymentSourceRow.projectId"),
    customerId: exactUuid(
      row.customer_user_id,
      "professionalPaymentSourceRow.customerId"
    ),
    paymentIntentId: row.payment_intent_id
  });
}

function assertSamePaymentSource(payment, source) {
  invariant(
    payment.paymentPurpose === source.paymentPurpose &&
      payment.receiptId === source.receiptId &&
      payment.organizationId === source.organizationId &&
      payment.projectId === source.projectId &&
      payment.customerId === source.customerId &&
      payment.paymentIntentId === source.paymentIntentId,
    "PROFESSIONAL_REVERSAL_REPOSITORY_CONFLICT",
    "The normalized professional payment binding changed identity.",
    { status: 500 }
  );
  return payment;
}

function resultFromRow(row) {
  exactKeys(
    row,
    [
      "access_consequence",
      "credit_consequence",
      "customer_user_id",
      "evidence_id",
      "lifecycle_id",
      "lifecycle_revision",
      "lifecycle_state",
      "organization_id",
      "payment_purpose",
      "project_id",
      "quote_consequence",
      "receipt_id",
      "reconciliation_required",
      "result_status",
      "severity"
    ],
    "professionalReversalResultRow"
  );
  invariant(
    ["recorded", "replay", "reconciliation_required", "reconciled"].includes(
      row.result_status
    ) && typeof row.reconciliation_required === "boolean",
    "PROFESSIONAL_REVERSAL_REPOSITORY_CONFLICT",
    "professionalReversalResultRow status is invalid",
    { status: 500 }
  );
  return deepFreeze({
    schema: PROFESSIONAL_REVERSAL_RESULT_SCHEMA,
    status: row.result_status,
    evidenceId: exactUuid(row.evidence_id, "professionalReversalResultRow.evidenceId"),
    lifecycleId: exactUuid(row.lifecycle_id, "professionalReversalResultRow.lifecycleId"),
    organizationId: exactUuid(
      row.organization_id,
      "professionalReversalResultRow.organizationId"
    ),
    projectId: exactUuid(row.project_id, "professionalReversalResultRow.projectId"),
    customerId: exactUuid(
      row.customer_user_id,
      "professionalReversalResultRow.customerId"
    ),
    paymentPurpose: row.payment_purpose,
    receiptId: exactUuid(row.receipt_id, "professionalReversalResultRow.receiptId"),
    lifecycleState: row.lifecycle_state,
    severity: exactInteger(row.severity, "professionalReversalResultRow.severity"),
    lifecycleRevision: exactInteger(
      row.lifecycle_revision,
      "professionalReversalResultRow.lifecycleRevision",
      1
    ),
    accessConsequence: row.access_consequence,
    creditConsequence: row.credit_consequence,
    quoteConsequence: row.quote_consequence,
    reconciliationRequired: row.reconciliation_required
  });
}

function replayFromRow(row, expected) {
  exactKeys(
    row,
    [
      "access_consequence", "credit_consequence", "customer_user_id",
      "evidence_id", "lifecycle_id", "lifecycle_revision",
      "lifecycle_state", "organization_id", "payment_intent_id",
      "payment_purpose", "project_id", "provider_event_type",
      "provider_object_id", "quote_consequence", "receipt_id",
      "reconciliation_required", "result_status", "severity"
    ],
    "professionalReversalReplayRow"
  );
  invariant(
    row.provider_event_type === expected.providerEventType &&
      row.payment_intent_id === expected.paymentIntentId &&
      row.provider_object_id === expected.providerObjectId,
    "PROFESSIONAL_REVERSAL_REPOSITORY_CONFLICT",
    "Retained professional reversal event identity changed.",
    { status: 500 }
  );
  const projected = { ...row };
  delete projected.provider_event_type;
  delete projected.payment_intent_id;
  delete projected.provider_object_id;
  return resultFromRow(projected);
}

function validateAuthority(value) {
  invariant(
    value && typeof value.service === "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Canonical PostgreSQL authority is required for professional reversals.",
    { status: 500 }
  );
  return value;
}

function databaseError(error) {
  if (error instanceof HostedError) return error;
  if (DATABASE_CODES.has(error?.code)) {
    return new HostedError(
      error.code === "40001" || error.code === "40P01"
        ? "PROFESSIONAL_REVERSAL_CHANGED"
        : "PROFESSIONAL_REVERSAL_REPOSITORY_CONFLICT",
      error.code === "40001" || error.code === "40P01"
        ? "The professional payment lifecycle changed; reconcile from fresh evidence."
        : "Professional reversal evidence rejected an inconsistent binding.",
      { status: error.code === "40001" || error.code === "40P01" ? 409 : 500 }
    );
  }
  return error;
}

async function translated(work) {
  try {
    return await work();
  } catch (error) {
    throw databaseError(error);
  }
}

function assertDecision(result, decision) {
  if (decision === null) return result;
  invariant(
    decision.schema === PROFESSIONAL_REVERSAL_DECISION_SCHEMA &&
      result.lifecycleState === decision.toState &&
      result.severity === decision.resultingSeverity &&
      result.accessConsequence === decision.accessConsequence &&
      result.creditConsequence === decision.creditConsequence &&
      result.quoteConsequence === decision.quoteConsequence,
    "PROFESSIONAL_REVERSAL_REPOSITORY_CONFLICT",
    "PostgreSQL reversal consequences disagree with the domain decision.",
    { status: 500 }
  );
  return result;
}

export function createPostgresProfessionalServicesReversalRepository({
  authority
} = {}) {
  const database = validateAuthority(authority);

  async function readiness() {
    try {
      const result = await database.service(
        { actorKind: "system", readOnly: true },
        (client) => client.query(`
          select
            to_regprocedure(
              'ss.hosted_runtime_contract_v108()'
            ) is not null
              and ss.hosted_runtime_contract_v108() =
                'canonical-ss-v108-professional-services-reversals'
              as contract_ready,
            to_regprocedure(
              'ss.direct_custom_reversal_normalization_contract_v1()'
            ) is not null
              and ss.direct_custom_reversal_normalization_contract_v1() =
                'canonical-direct-custom-reversal-normalization-v1-held'
              as direct_normalization_ready,
            count(*) = 3 as tables_ready,
            bool_and(c.relrowsecurity and c.relforcerowsecurity)
              as rls_ready,
            bool_and(
              has_table_privilege(
                'service_role', c.oid, 'SELECT'
              )
              and not has_table_privilege(
                'service_role', c.oid, 'INSERT,UPDATE,DELETE'
              )
              and not has_table_privilege(
                'authenticated', c.oid,
                'SELECT,INSERT,UPDATE,DELETE'
              )
              and not has_table_privilege(
                'anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE'
              )
            ) as grants_ready
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'ss'
            and c.relname = any($1::text[])
        `, [[
          "service_professional_payment_lifecycles",
          "service_professional_reversal_evidence",
          "service_professional_reversal_reconciliations"
        ]])
      );
      const row = result.rows[0] ?? {};
      const ready = row.contract_ready === true &&
        row.direct_normalization_ready === true &&
        row.tables_ready === true && row.rls_ready === true &&
        row.grants_ready === true;
      return Object.freeze({
        ready,
        verified: ready,
        kind: "professional-services-reversal-postgres",
        code: ready ? null : "PROFESSIONAL_REVERSAL_NOT_MIGRATED",
        sourceAuthoritative: true,
        monotonic: true,
        directNormalization:
          row.direct_normalization_ready === true
            ? "held"
            : "not_ready",
        providerEffects: false,
        automaticRestoration: false
      });
    } catch {
      return Object.freeze({
        ready: false,
        verified: false,
        kind: "professional-services-reversal-postgres",
        code: "PROFESSIONAL_REVERSAL_DATABASE_UNAVAILABLE",
        sourceAuthoritative: true,
        monotonic: true,
        directNormalization: "not_ready",
        providerEffects: false,
        automaticRestoration: false
      });
    }
  }

  async function findPaymentByIntent({ organizationId, paymentIntentId }) {
    invariant(UUID.test(String(organizationId ?? "")), "invalid_input", "organizationId is invalid", { status: 400 });
    invariant(PAYMENT_INTENT_ID.test(String(paymentIntentId ?? "")), "invalid_input", "paymentIntentId is invalid", { status: 400 });
    return translated(() => database.service(
      {
        actorKind: "system",
        organizationId,
        readOnly: true
      },
      async (client) => {
        const selected = one(await client.query(
          `select *
             from ss.service_professional_payment_binding_by_intent($1, $2)`,
          [organizationId, paymentIntentId]
        ), "professionalPaymentBinding", { optional: true });
        return selected === null ? null : paymentFromRow(selected);
      }
    ));
  }

  async function resolvePaymentByIntent({ paymentIntentId } = {}) {
    invariant(PAYMENT_INTENT_ID.test(String(paymentIntentId ?? "")), "invalid_input", "paymentIntentId is invalid", { status: 400 });
    const source = await translated(() => database.service(
      { actorKind: "system", readOnly: true },
      async (client) => {
        const selected = one(await client.query(`
          select candidate.*
          from (
            select
              'assessment'::text as payment_purpose,
              receipt.id as receipt_id,
              receipt.organization_id,
              receipt.project_id,
              receipt.customer_user_id,
              receipt.payment_intent_id
            from ss.service_assessment_payment_receipts receipt
            where receipt.payment_intent_id = $1

            union all

            select
              'custom_build_initial'::text,
              receipt.id,
              receipt.organization_id,
              receipt.project_id,
              receipt.customer_user_id,
              receipt.payment_intent_id
            from ss.service_custom_build_payment_receipts receipt
            where receipt.payment_intent_id = $1

            union all

            select
              'custom_build_change'::text,
              receipt.id,
              receipt.organization_id,
              receipt.project_id,
              receipt.customer_user_id,
              receipt.payment_intent_id
            from ss.service_custom_build_change_payment_receipts receipt
            where receipt.payment_intent_id = $1

            union all

            select
              'custom_build_final'::text,
              receipt.id,
              receipt.organization_id,
              receipt.project_id,
              receipt.customer_user_id,
              receipt.payment_intent_id
            from ss.service_custom_build_final_payment_receipts receipt
            where receipt.payment_intent_id = $1
          ) candidate
        `, [paymentIntentId]), "professionalPaymentSource", { optional: true });
        return selected === null ? null : paymentSourceFromRow(selected);
      }
    ));
    if (source === null) return null;
    const payment = await findPaymentByIntent({
      organizationId: source.organizationId,
      paymentIntentId
    });
    invariant(
      payment !== null,
      "PROFESSIONAL_REVERSAL_REPOSITORY_CONFLICT",
      "The professional payment source has no normalized reversal binding.",
      { status: 500 }
    );
    return assertSamePaymentSource(payment, source);
  }

  async function findEvidenceByEvent({
    organizationId,
    providerEventId,
    providerEventType,
    paymentIntentId,
    providerObjectId
  }) {
    invariant(UUID.test(String(organizationId ?? "")), "invalid_input", "organizationId is invalid", { status: 400 });
    invariant(/^evt_[A-Za-z0-9_]+$/u.test(String(providerEventId ?? "")), "invalid_input", "providerEventId is invalid", { status: 400 });
    return translated(() => database.service(
      { actorKind: "system", organizationId, readOnly: true },
      async (client) => {
        const selected = one(await client.query(`
          select
            'replay'::text as result_status,
            evidence.id as evidence_id,
            lifecycle.id as lifecycle_id,
            lifecycle.organization_id,
            lifecycle.project_id,
            lifecycle.customer_user_id,
            lifecycle.payment_purpose,
            lifecycle.payment_receipt_id as receipt_id,
            lifecycle.state as lifecycle_state,
            lifecycle.severity,
            lifecycle.revision as lifecycle_revision,
            lifecycle.access_consequence,
            lifecycle.credit_consequence,
            lifecycle.quote_consequence,
            lifecycle.reconciliation_required,
            evidence.provider_event_type,
            evidence.payment_intent_id,
            evidence.provider_object_id
          from ss.service_professional_reversal_evidence evidence
          join ss.service_professional_payment_lifecycles lifecycle
            on lifecycle.id = evidence.lifecycle_id
           and lifecycle.organization_id = evidence.organization_id
          where evidence.organization_id = $1
            and evidence.provider_event_id = $2
        `, [organizationId, providerEventId]), "professionalReversalReplay", {
          optional: true
        });
        return selected === null ? null : replayFromRow(selected, {
          providerEventType,
          paymentIntentId,
          providerObjectId
        });
      }
    ));
  }

  async function recordEvidence(input) {
    const payment = exactProfessionalPayment(input.payment);
    return translated(() => database.service(
      {
        actorKind: "system",
        organizationId: payment.organizationId,
        isolation: "serializable"
      },
      async (client) => {
        const selected = one(await client.query(
          `select * from ss.record_service_professional_reversal(
             $1, $2, $3, $4, $5, $6, $7, $8, $9,
             $10, $11, $12, $13, $14::jsonb, $15, $16, $17
           )`,
          [
            input.evidenceId,
            input.lifecycleId,
            payment.paymentPurpose,
            payment.receiptId,
            input.providerEventId,
            input.providerEventType,
            input.paymentIntentId,
            input.providerObjectId,
            input.evidenceCertainty,
            input.outcome,
            input.amountChargedMinor,
            input.amountReversedMinor,
            input.currency,
            JSON.stringify(input.providerFacts),
            input.providerFactsDigest,
            input.providerObservedAt,
            input.recordedAt
          ]
        ), "professionalReversalRecord");
        return assertDecision(resultFromRow(selected), input.decision);
      }
    ));
  }

  async function reconcileEvidence(input) {
    return translated(() => database.service(
      {
        actorKind: "operator",
        userId: input.operatorId,
        organizationId: input.organizationId,
        isolation: "serializable"
      },
      async (client) => resultFromRow(one(await client.query(
        `select * from ss.reconcile_service_professional_reversal(
           $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12
         )`,
        [
          input.reconciliationId,
          input.organizationId,
          input.evidenceId,
          input.operatorId,
          input.commandId,
          input.expectedLifecycleRevision,
          input.resolution,
          JSON.stringify(input.verifiedFacts),
          input.verifiedFactsDigest,
          input.verifiedObservedAt,
          input.confirmedOutcome,
          input.reconciledAt
        ]
      ), "professionalReversalReconciliation"))
    ));
  }

  return Object.freeze({
    readiness,
    findEvidenceByEvent,
    findPaymentByIntent,
    resolvePaymentByIntent,
    recordEvidence,
    reconcileEvidence
  });
}
