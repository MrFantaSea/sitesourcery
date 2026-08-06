import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";

export const CUSTOM_BUILD_OWNER_JOBS_SCHEMA =
  "sitesourcery.custom-services-owner-custom-build-jobs/v1";

const CUSTOM_BUILD_WORK_READINESS_SCHEMA =
  "sitesourcery.custom-build-work-readiness/v1";
const RUNTIME_CONTRACT =
  "canonical-ss-v42-custom-build-start-payment";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
const CANONICAL_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const UNSIGNED_INTEGER = /^(0|[1-9][0-9]*)$/u;
const TIER_RULES = new Map([
  ["card", { amountMinor: 40_000, maxima: [1, 5, 1, 500, 2] }],
  ["card-plus", { amountMinor: 65_000, maxima: [1, 8, 1, 900, 8] }],
  ["site", { amountMinor: 120_000, maxima: [4, 16, 4, 1_800, 12] }],
  ["site-plus", { amountMinor: 180_000, maxima: [7, 28, 7, 3_000, 24] }],
  ["signature", { amountMinor: 280_000, maxima: [10, 40, 10, 4_500, 36] }],
  ["flagship", { amountMinor: 400_000, maxima: [15, 60, 15, 7_000, 60] }],
  ["scale", { amountMinor: null, maxima: [30, 120, 30, 14_500, 120] }]
]);
const TIER_IDS = new Set(TIER_RULES.keys());
const DATABASE_CONFLICT_CODES = new Set([
  "22001",
  "22P02",
  "23502",
  "23503",
  "23505",
  "23514",
  "40001",
  "40P01",
  "55000"
]);

function actorId(value) {
  if (!value || typeof value.userId !== "string" || !UUID.test(value.userId)) {
    throw new HostedError(
      "AUTHENTICATION_REQUIRED",
      "Sign in before opening Custom-build work tools.",
      { status: 401 }
    );
  }
  return value.userId;
}

function validateAuthority(value) {
  invariant(
    value && typeof value.service === "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Canonical PostgreSQL authority is required for Custom-build work.",
    { status: 500 }
  );
  return value;
}

function repositoryInvariant(condition, message) {
  invariant(
    condition,
    "CUSTOM_BUILD_WORK_REPOSITORY_CONFLICT",
    message,
    { status: 500 }
  );
}

function rows(result, field, { maximum = Number.MAX_SAFE_INTEGER } = {}) {
  repositoryInvariant(
    result &&
      Array.isArray(result.rows) &&
      Number.isSafeInteger(result.rowCount) &&
      result.rowCount === result.rows.length &&
      result.rowCount <= maximum,
    `${field} is invalid.`
  );
  return result.rows;
}

function one(result, field) {
  const selected = rows(result, field, { maximum: 1 });
  repositoryInvariant(selected.length === 1, `${field} is unavailable.`);
  return selected[0];
}

function storedUuid(value, field) {
  repositoryInvariant(
    typeof value === "string" && UUID.test(value),
    `${field} is invalid.`
  );
  return value;
}

function storedText(value, field, minimum, maximum) {
  repositoryInvariant(
    typeof value === "string" &&
      value.length >= minimum &&
      value.length <= maximum &&
      !CONTROL_CHARACTER.test(value),
    `${field} is invalid.`
  );
  return value;
}

function storedInteger(value, field, minimum, maximum) {
  const candidate = typeof value === "number"
    ? value
    : typeof value === "string" && UNSIGNED_INTEGER.test(value)
      ? Number(value)
      : Number.NaN;
  repositoryInvariant(
    Number.isSafeInteger(candidate) &&
      candidate >= minimum &&
      candidate <= maximum,
    `${field} is invalid.`
  );
  return candidate;
}

function canonicalIso(value, field) {
  const selected = value instanceof Date
    ? new Date(value.getTime())
    : typeof value === "string"
      ? new Date(value)
      : null;
  repositoryInvariant(
    selected !== null && !Number.isNaN(selected.getTime()),
    `${field} is invalid.`
  );
  return selected.toISOString();
}

function canonicalDate(value, field) {
  repositoryInvariant(
    typeof value === "string" && CANONICAL_DATE.test(value),
    `${field} is invalid.`
  );
  const selected = new Date(`${value}T00:00:00.000Z`);
  repositoryInvariant(
    !Number.isNaN(selected.getTime()) &&
      selected.toISOString().slice(0, 10) === value,
    `${field} is invalid.`
  );
  return value;
}

function listCursor(value) {
  if (value === null || value === undefined) return null;
  invariant(
    typeof value === "string" && value.length <= 96,
    "INVALID_CUSTOM_BUILD_WORK_CURSOR",
    "The paid Custom-build job cursor is invalid.",
    { status: 400 }
  );
  const parts = value.split("|");
  invariant(
    parts.length === 3 && UUID.test(parts[2]),
    "INVALID_CUSTOM_BUILD_WORK_CURSOR",
    "The paid Custom-build job cursor is invalid.",
    { status: 400 }
  );
  let openedAt;
  let targetCompletionDate;
  try {
    openedAt = new Date(parts[1]).toISOString();
    targetCompletionDate = new Date(`${parts[0]}T00:00:00.000Z`)
      .toISOString()
      .slice(0, 10);
  } catch {
    openedAt = null;
    targetCompletionDate = null;
  }
  invariant(
    CANONICAL_DATE.test(parts[0]) &&
      targetCompletionDate === parts[0] &&
      openedAt === parts[1],
    "INVALID_CUSTOM_BUILD_WORK_CURSOR",
    "The paid Custom-build job cursor is invalid.",
    { status: 400 }
  );
  return Object.freeze({
    targetCompletionDate: parts[0],
    openedAt,
    jobId: parts[2]
  });
}

function nextCursor(job) {
  return [job.targetCompletionDate, job.openedAt, job.jobId].join("|");
}

function exactTierPayment(tierId, footprint) {
  const rule = TIER_RULES.get(tierId);
  repositoryInvariant(Boolean(rule), "Custom-build job tier is invalid.");
  const values = [
    footprint.craftedPages,
    footprint.sections,
    footprint.uniqueLayouts,
    footprint.contentWords,
    footprint.suppliedMedia
  ];
  repositoryInvariant(
    values.every((value, index) => value <= rule.maxima[index]),
    "Custom-build job footprint exceeds its tier boundary."
  );
  let amountMinor = rule.amountMinor;
  if (tierId === "scale") {
    const scaleUnits = Math.max(
      Math.max(footprint.craftedPages - 15, 0),
      Math.ceil(Math.max(footprint.sections - 60, 0) / 4),
      Math.max(footprint.uniqueLayouts - 15, 0),
      Math.ceil(Math.max(footprint.contentWords - 7_000, 0) / 500),
      Math.ceil(Math.max(footprint.suppliedMedia - 60, 0) / 4)
    );
    repositoryInvariant(
      scaleUnits >= 1 && scaleUnits <= 15,
      "Custom-build Scale footprint is invalid."
    );
    amountMinor = 400_000 + scaleUnits * 27_000;
  }
  const grossMinor = ["card", "card-plus"].includes(tierId)
    ? amountMinor
    : amountMinor / 2;
  return {
    grossMinor,
    creditMinor: 20_000,
    paidSubtotalMinor: grossMinor - 20_000,
    finalAmountMinor: amountMinor - grossMinor
  };
}

function safeJob(row) {
  repositoryInvariant(
    row !== null && typeof row === "object" && !Array.isArray(row),
    "Custom-build job is invalid."
  );
  repositoryInvariant(
    row.linkage_valid === true,
    "Custom-build job linkage is inconsistent."
  );

  const jobId = storedUuid(row.job_id, "Custom-build job ID");
  repositoryInvariant(
    row.state === "open",
    "Custom-build job state is invalid."
  );
  repositoryInvariant(
    typeof row.tier_id === "string" && TIER_IDS.has(row.tier_id),
    "Custom-build job tier is invalid."
  );
  repositoryInvariant(
    row.currency === "USD",
    "Custom-build job currency is invalid."
  );

  const craftedPages = storedInteger(
    row.crafted_pages,
    "Custom-build crafted-page count",
    1,
    30
  );
  const sections = storedInteger(
    row.sections,
    "Custom-build section count",
    1,
    120
  );
  const uniqueLayouts = storedInteger(
    row.unique_layouts,
    "Custom-build unique-layout count",
    1,
    30
  );
  const contentWords = storedInteger(
    row.content_words,
    "Custom-build content-word count",
    0,
    14_500
  );
  const suppliedMedia = storedInteger(
    row.supplied_media,
    "Custom-build supplied-media count",
    0,
    120
  );
  const grossMinor = storedInteger(
    row.start_gross_minor,
    "Custom-build first-payment gross amount",
    1,
    Number.MAX_SAFE_INTEGER
  );
  const creditMinor = storedInteger(
    row.start_credit_minor,
    "Custom-build first-payment credit amount",
    1,
    Number.MAX_SAFE_INTEGER
  );
  const paidSubtotalMinor = storedInteger(
    row.start_paid_subtotal_minor,
    "Custom-build first-payment paid subtotal",
    1,
    Number.MAX_SAFE_INTEGER
  );
  const finalAmountMinor = storedInteger(
    row.final_due_minor,
    "Custom-build final handoff amount",
    0,
    Number.MAX_SAFE_INTEGER
  );
  const exactPayment = exactTierPayment(row.tier_id, {
    craftedPages,
    sections,
    uniqueLayouts,
    contentWords,
    suppliedMedia
  });
  repositoryInvariant(
    grossMinor === exactPayment.grossMinor &&
      creditMinor === exactPayment.creditMinor &&
      paidSubtotalMinor === exactPayment.paidSubtotalMinor &&
      finalAmountMinor === exactPayment.finalAmountMinor,
    "Custom-build payment amounts do not match the exact tier."
  );
  repositoryInvariant(
    (finalAmountMinor === 0 && row.final_payment_state === "not_required") ||
      (finalAmountMinor > 0 && row.final_payment_state === "unpaid"),
    "Custom-build final handoff state is inconsistent."
  );

  return {
    jobId,
    state: row.state,
    openedAt: canonicalIso(row.opened_at, "Custom-build opened time"),
    tierId: row.tier_id,
    scopeStatement: storedText(
      row.scope_statement,
      "Custom-build scope statement",
      20,
      2_000
    ),
    footprint: {
      craftedPages,
      sections,
      uniqueLayouts,
      contentWords,
      suppliedMedia
    },
    targetCompletionDate: canonicalDate(
      row.target_completion_date,
      "Custom-build target completion date"
    ),
    firstPayment: {
      grossMinor,
      creditMinor,
      paidSubtotalMinor,
      currency: row.currency
    },
    finalHandoff: {
      amountMinor: finalAmountMinor,
      currency: row.currency,
      state: row.final_payment_state
    }
  };
}

function ownerJob(row) {
  return {
    organizationId: storedUuid(
      row.organization_id,
      "Custom-build organization ID"
    ),
    organizationName: storedText(
      row.organization_name,
      "Custom-build organization name",
      2,
      120
    ),
    projectId: storedUuid(row.project_id, "Custom-build project ID"),
    projectName: storedText(
      row.project_name,
      "Custom-build project name",
      2,
      120
    ),
    caseId: storedUuid(row.case_id, "Custom-build case ID"),
    customer: {
      customerId: storedUuid(
        row.customer_user_id,
        "Custom-build customer ID"
      ),
      name: storedText(
        row.customer_name,
        "Custom-build customer name",
        1,
        100
      ),
      email: storedText(
        row.customer_email,
        "Custom-build customer email",
        3,
        320
      )
    },
    job: safeJob(row)
  };
}

async function requireOperator(client, operatorUserId) {
  let selected;
  try {
    selected = await client.query(
      `select ss.service_operator_has_capability(
         $1, $2, clock_timestamp()
       ) as authorized`,
      [operatorUserId, "service_job_manage"]
    );
  } catch (error) {
    if (error?.code === "42501") {
      throw new HostedError(
        "OPERATOR_ACCESS_REQUIRED",
        "Custom-build work tools are unavailable for this account.",
        { status: 403 }
      );
    }
    throw error;
  }
  const row = one(
    selected,
    "Custom-build work operator"
  );
  invariant(
    row.authorized === true,
    "OPERATOR_ACCESS_REQUIRED",
    "Custom-build work tools are unavailable for this account.",
    { status: 403 }
  );
}

function databaseError(error) {
  if (error instanceof HostedError) return error;
  if (error?.code === "42501") {
    return new HostedError(
      "CUSTOM_BUILD_WORK_REPOSITORY_CONFLICT",
      "Custom-build work storage is unavailable.",
      { status: 500 }
    );
  }
  if (DATABASE_CONFLICT_CODES.has(error?.code)) {
    return new HostedError(
      "CUSTOM_BUILD_WORK_CHANGED",
      "Custom-build work changed. Refresh before trying again.",
      { status: 409 }
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

function heldError() {
  throw new HostedError(
    "CUSTOM_BUILD_WORK_HELD",
    "Custom-build work tools are held in this runtime.",
    { status: 503 }
  );
}

export function createHeldCustomServicesCustomBuildWork() {
  return Object.freeze({
    async readiness() {
      return deepFreeze({
        schema: CUSTOM_BUILD_WORK_READINESS_SCHEMA,
        ready: false,
        state: "held"
      });
    },
    async listJobs(actor, cursorValue = null) {
      actorId(actor);
      listCursor(cursorValue);
      return heldError();
    }
  });
}

export function createPostgresCustomServicesCustomBuildWork({ authority } = {}) {
  const database = validateAuthority(authority);

  return Object.freeze({
    async readiness() {
      return translated(() => database.service(
        { readOnly: true },
        async (client) => {
          const selected = await client.query(
            `select ss.hosted_runtime_contract_v42() as runtime_contract`
          );
          const contract = rows(
            selected,
            "Custom-build work runtime contract",
            { maximum: 1 }
          );
          invariant(
            contract.length === 1 &&
              contract[0].runtime_contract === RUNTIME_CONTRACT,
            "CUSTOM_BUILD_WORK_HELD",
            "Custom-build work storage is not ready.",
            { status: 503 }
          );
          return deepFreeze({
            schema: CUSTOM_BUILD_WORK_READINESS_SCHEMA,
            ready: true,
            state: "ready",
            runtimeContract: RUNTIME_CONTRACT,
            readOnly: true
          });
        }
      ));
    },

    async listJobs(actor, cursorValue = null) {
      const operatorUserId = actorId(actor);
      const cursor = listCursor(cursorValue);
      return translated(() => database.service(
        { userId: operatorUserId, readOnly: true },
        async (client) => {
          await requireOperator(client, operatorUserId);
          const selected = await client.query(
            `select
               job.organization_id,
               organization.name as organization_name,
               job.project_id,
               project.name as project_name,
               job.case_id,
               job.customer_user_id,
               account_profile.display_name as customer_name,
               account_user.email as customer_email,
               job.id as job_id,
               job.state,
               job.opened_at,
               job.tier_id,
               job.scope_statement,
               job.crafted_pages,
               job.sections,
               job.unique_layouts,
               job.content_words,
               job.supplied_media,
               job.target_completion_date::text as target_completion_date,
               job.start_gross_minor,
               job.start_credit_minor,
               job.start_paid_subtotal_minor,
               job.final_due_minor,
               job.final_payment_state,
               job.currency,
               (
                 job.project_id = invoice.project_id
                 and job.case_id = invoice.case_id
                 and job.customer_user_id = invoice.customer_user_id
                 and job.quote_id = invoice.quote_id
                 and job.quote_revision = invoice.quote_revision
                 and job.quote_revision_id = invoice.quote_revision_id
                 and job.quote_acceptance_id = invoice.quote_acceptance_id
                 and job.policy_id = invoice.policy_id
                 and job.scope_boundary_digest = invoice.scope_boundary_digest
                 and job.tier_id = invoice.tier_id
                 and job.accepted_quote_digest = invoice.accepted_quote_digest
                 and job.accepted_disclosure_digest =
                   invoice.accepted_disclosure_digest
                 and job.start_gross_minor = invoice.gross_start_minor
                 and job.start_credit_minor = invoice.credit_minor
                 and job.start_paid_subtotal_minor = invoice.subtotal_minor
                 and job.final_due_minor = invoice.final_due_minor
                 and job.currency = invoice.currency
                 and job.payment_receipt_id = receipt.id
                 and receipt.invoice_id = invoice.id
                 and receipt.project_id = invoice.project_id
                 and receipt.case_id = invoice.case_id
                 and receipt.customer_user_id = invoice.customer_user_id
                 and receipt.credit_application_id =
                   invoice.credit_application_id
                 and receipt.subtotal_minor = invoice.subtotal_minor
                 and receipt.currency = invoice.currency
                 and receipt.invoice_digest = invoice.invoice_digest
                 and receipt.accepted_quote_digest =
                   invoice.accepted_quote_digest
                 and receipt.accepted_disclosure_digest =
                   invoice.accepted_disclosure_digest
                 and revision.scope_statement = job.scope_statement
                 and revision.project_id = job.project_id
                 and revision.case_id = job.case_id
                 and revision.customer_user_id = job.customer_user_id
                 and revision.policy_id = job.policy_id
                 and revision.scope_boundary_digest =
                   job.scope_boundary_digest
                 and revision.quote_digest = job.accepted_quote_digest
                 and revision.disclosure_digest =
                   job.accepted_disclosure_digest
                 and revision.tier_id = job.tier_id
                 and revision.crafted_pages = job.crafted_pages
                 and revision.sections = job.sections
                 and revision.unique_layouts = job.unique_layouts
                 and revision.content_words = job.content_words
                 and revision.supplied_media = job.supplied_media
                 and revision.target_completion_date =
                   job.target_completion_date
                 and revision.start_value_minor = job.start_gross_minor
                 and revision.start_credit_minor = job.start_credit_minor
                 and revision.start_due_minor =
                   job.start_paid_subtotal_minor
                 and revision.final_due_minor = job.final_due_minor
                 and revision.currency = job.currency
                 and receipt.payment_status = 'paid'
                 and receipt.provider = 'stripe'
               ) as linkage_valid
             from ss.service_custom_build_jobs job
             join ss.service_custom_build_invoices invoice
               on invoice.organization_id = job.organization_id
              and invoice.id = job.invoice_id
             join ss.service_custom_build_payment_receipts receipt
               on receipt.organization_id = job.organization_id
              and receipt.id = job.payment_receipt_id
             join ss.service_custom_build_quote_revisions revision
               on revision.organization_id = job.organization_id
              and revision.quote_id = job.quote_id
              and revision.quote_revision = job.quote_revision
              and revision.id = job.quote_revision_id
             join ss.organizations organization
               on organization.id = job.organization_id
             join ss.projects project
               on project.organization_id = job.organization_id
              and project.id = job.project_id
             join auth.users account_user
               on account_user.id = job.customer_user_id
             join ss.hosted_account_profiles account_profile
               on account_profile.user_id = job.customer_user_id
            where (
              $1::text is null
              or (job.target_completion_date, job.opened_at, job.id) >
                ($1::date, $2::timestamptz, $3::uuid)
            )
            order by
              job.target_completion_date asc,
              job.opened_at asc,
              job.id asc
            limit 101`,
            cursor === null
              ? [null, null, null]
              : [
                  cursor.targetCompletionDate,
                  cursor.openedAt,
                  cursor.jobId
                ]
          );
          const jobs = rows(selected, "Custom-build jobs", { maximum: 101 });
          const hasMore = jobs.length > 100;
          const projected = jobs.slice(0, 100).map(ownerJob);
          return deepFreeze({
            schema: CUSTOM_BUILD_OWNER_JOBS_SCHEMA,
            hasMore,
            nextCursor: hasMore
              ? nextCursor(projected[projected.length - 1].job)
              : null,
            jobs: projected
          });
        }
      ));
    }
  });
}
