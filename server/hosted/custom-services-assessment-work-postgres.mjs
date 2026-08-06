import { createHash, randomUUID as systemRandomUUID } from "node:crypto";

import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";
import { digest } from "./security.mjs";
import {
  SERVICE_IMAGE_EVIDENCE_MEDIA_EXTENSIONS as MEDIA_EXTENSIONS,
  validateServiceImageEvidence
} from "./service-image-evidence.mjs";

export const CUSTOM_SERVICES_OWNER_ASSESSMENT_JOBS_SCHEMA =
  "sitesourcery.custom-services-owner-assessment-jobs/v1";
export const CUSTOM_SERVICES_OWNER_ASSESSMENT_EVIDENCE_SCHEMA =
  "sitesourcery.custom-services-owner-assessment-evidence/v1";
export const CUSTOM_SERVICES_OWNER_ASSESSMENT_FINDING_SCHEMA =
  "sitesourcery.custom-services-owner-assessment-finding/v1";
export const CUSTOM_SERVICES_OWNER_ASSESSMENT_DELIVERY_SCHEMA =
  "sitesourcery.custom-services-owner-assessment-delivery/v1";
export const CUSTOM_SERVICES_CUSTOMER_ASSESSMENT_REPORT_SCHEMA =
  "sitesourcery.custom-services-assessment-report/v1";
export const CUSTOM_SERVICES_ASSESSMENT_REPORT_DOCUMENT_SCHEMA =
  "sitesourcery.assessment-report/v1";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
const PAGE_PATH = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/u;
const PAGE_TYPE = /^[a-z][a-z0-9_]{1,79}$/u;
const MAXIMUM_REPORT_BYTES = 256 * 1024;
const ELIGIBLE_TIER_IDS = Object.freeze([
  "card",
  "card-plus",
  "site",
  "site-plus",
  "signature",
  "flagship",
  "scale"
]);
const SEVERITIES = new Set([
  "critical",
  "high",
  "moderate",
  "low",
  "positive"
]);
const CATEGORIES = new Set([
  "accessibility",
  "content",
  "functionality",
  "performance",
  "responsive_design",
  "search_visibility",
  "security_observation",
  "usability",
  "visual_design"
]);

function exactKeys(value, expected, field, options = {}) {
  invariant(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...expected].sort()),
    options.code ?? "invalid_input",
    `${field} is invalid`,
    { status: options.status ?? 400 }
  );
  return value;
}

function uuid(value, field) {
  invariant(
    typeof value === "string" && UUID.test(value),
    "invalid_input",
    `${field} is invalid`,
    { status: 400 }
  );
  return value;
}

function sha(value, field) {
  invariant(
    typeof value === "string" && SHA256.test(value),
    "invalid_input",
    `${field} is invalid`,
    { status: 400 }
  );
  return value;
}

function actorId(value, message = "Sign in before opening assessment work tools.") {
  if (!value || typeof value.userId !== "string" || !UUID.test(value.userId)) {
    throw new HostedError("AUTHENTICATION_REQUIRED", message, { status: 401 });
  }
  return value.userId;
}

function commandId(value) {
  invariant(
    typeof value === "string" &&
      value === value.trim() &&
      value.length >= 8 &&
      value.length <= 200 &&
      !CONTROL_CHARACTER.test(value),
    "invalid_input",
    "commandId is invalid",
    { status: 400 }
  );
  return value;
}

function text(value, field, minimum, maximum) {
  invariant(
    typeof value === "string" &&
      value === value.trim() &&
      value.length >= minimum &&
      value.length <= maximum &&
      !CONTROL_CHARACTER.test(value),
    "invalid_input",
    `${field} is invalid`,
    { status: 400 }
  );
  return value;
}

function integer(value, field, minimum, maximum) {
  const selected = Number(value);
  invariant(
    Number.isSafeInteger(selected) &&
      selected >= minimum &&
      selected <= maximum,
    "invalid_input",
    `${field} is invalid`,
    { status: 400 }
  );
  return selected;
}

function iso(value, field = "assessment timing") {
  const selected = value instanceof Date ? value : new Date(value);
  invariant(
    !Number.isNaN(selected.getTime()),
    "assessment_work_repository_conflict",
    `${field} is invalid`,
    { status: 500 }
  );
  return selected.toISOString();
}

function canonicalDate(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return value;
  }
  return iso(value).slice(0, 10);
}

function target(value, field = "reviewTarget") {
  exactKeys(value, ["kind", "value"], field);
  const selected = text(value.value, `${field}.value`, 1, 154);
  if (value.kind === "page") {
    invariant(
      PAGE_PATH.test(selected) && !/(^|\/)\.\.?($|\/)/u.test(selected),
      "invalid_input",
      `${field} must be a safe public path`,
      { status: 400 }
    );
    return `page:${selected}`;
  }
  invariant(
    value.kind === "page_type" && PAGE_TYPE.test(selected),
    "invalid_input",
    `${field} must be a safe page type`,
    { status: 400 }
  );
  return `type:${selected}`;
}

function publicTarget(value) {
  invariant(
    typeof value === "string" &&
      (value.startsWith("page:") || value.startsWith("type:")),
    "assessment_work_repository_conflict",
    "The stored assessment target is invalid",
    { status: 500 }
  );
  return value.startsWith("page:")
    ? Object.freeze({ kind: "page", value: value.slice(5) })
    : Object.freeze({ kind: "page_type", value: value.slice(5) });
}

function viewport(value) {
  invariant(
    value === "desktop" || value === "phone",
    "invalid_input",
    "viewport is invalid",
    { status: 400 }
  );
  return value;
}

function viewports(value) {
  invariant(
    Array.isArray(value) && value.length >= 1 && value.length <= 2,
    "invalid_input",
    "viewports are invalid",
    { status: 400 }
  );
  const selected = [...new Set(value.map(viewport))].sort();
  invariant(
    selected.length === value.length,
    "invalid_input",
    "viewports must be unique",
    { status: 400 }
  );
  return Object.freeze(selected);
}

function evidenceIds(value) {
  invariant(
    Array.isArray(value) && value.length >= 1 && value.length <= 10,
    "invalid_input",
    "evidenceIds are invalid",
    { status: 400 }
  );
  const selected = [...new Set(value.map((id) => uuid(id, "evidenceId")))].sort();
  invariant(
    selected.length === value.length,
    "invalid_input",
    "evidenceIds must be unique",
    { status: 400 }
  );
  return Object.freeze(selected);
}

async function evidenceInput(value) {
  exactKeys(
    value,
    [
      "accessibleDescription",
      "bytesBase64",
      "commandId",
      "mediaType",
      "organizationId",
      "reviewTarget",
      "viewport"
    ],
    "assessmentEvidenceInput"
  );
  const { bytes, mediaType: selectedMediaType } =
    await validateServiceImageEvidence({
      bytesBase64: value.bytesBase64,
      mediaType: value.mediaType
    });
  return Object.freeze({
    accessibleDescription: text(
      value.accessibleDescription,
      "accessibleDescription",
      10,
      500
    ),
    bytes,
    commandId: commandId(value.commandId),
    mediaType: selectedMediaType,
    organizationId: uuid(value.organizationId, "organizationId"),
    reviewTarget: target(value.reviewTarget),
    viewport: viewport(value.viewport)
  });
}

function findingInput(value) {
  exactKeys(
    value,
    [
      "category",
      "commandId",
      "evidenceIds",
      "expectedRevision",
      "included",
      "organizationId",
      "primaryTarget",
      "recommendation",
      "severity",
      "summary",
      "viewports"
    ],
    "assessmentFindingInput"
  );
  invariant(
    typeof value.included === "boolean",
    "invalid_input",
    "included is invalid",
    { status: 400 }
  );
  invariant(
    SEVERITIES.has(value.severity),
    "invalid_input",
    "severity is invalid",
    { status: 400 }
  );
  invariant(
    CATEGORIES.has(value.category),
    "invalid_input",
    "category is invalid",
    { status: 400 }
  );
  return Object.freeze({
    category: value.category,
    commandId: commandId(value.commandId),
    evidenceIds: evidenceIds(value.evidenceIds),
    expectedRevision: integer(
      value.expectedRevision,
      "expectedRevision",
      0,
      Number.MAX_SAFE_INTEGER
    ),
    included: value.included,
    organizationId: uuid(value.organizationId, "organizationId"),
    primaryTarget: target(value.primaryTarget, "primaryTarget"),
    recommendation: text(value.recommendation, "recommendation", 10, 1500),
    severity: value.severity,
    summary: text(value.summary, "summary", 10, 240),
    viewports: viewports(value.viewports)
  });
}

function deliveryInput(value) {
  exactKeys(
    value,
    [
      "commandId",
      "expectedWorkDigest",
      "organizationId",
      "overallSummary"
    ],
    "assessmentDeliveryInput"
  );
  return Object.freeze({
    commandId: commandId(value.commandId),
    expectedWorkDigest: sha(value.expectedWorkDigest, "expectedWorkDigest"),
    organizationId: uuid(value.organizationId, "organizationId"),
    overallSummary: text(value.overallSummary, "overallSummary", 20, 2000)
  });
}

function validateAuthority(value) {
  invariant(
    value && typeof value.service === "function",
    "invalid_configuration",
    "canonical PostgreSQL authority is required",
    { status: 500 }
  );
  return value;
}

function rows(result, field) {
  invariant(
    result &&
      Array.isArray(result.rows) &&
      Number.isSafeInteger(result.rowCount) &&
      result.rowCount === result.rows.length,
    "assessment_work_repository_conflict",
    `${field} is invalid`,
    { status: 500 }
  );
  return result.rows;
}

function one(result, field, { optional = false } = {}) {
  const selected = rows(result, field);
  invariant(
    selected.length <= 1,
    "assessment_work_repository_conflict",
    `${field} conflicts`,
    { status: 500 }
  );
  if (selected.length === 0) {
    invariant(
      optional,
      "ASSESSMENT_JOB_UNAVAILABLE",
      "That assessment job is unavailable.",
      { status: 404 }
    );
    return null;
  }
  return selected[0];
}

async function requireOperator(client, operatorUserId, capability) {
  const row = one(
    await client.query(
      `select ss.service_operator_has_capability(
         $1, $2, clock_timestamp()
       ) as authorized`,
      [operatorUserId, capability]
    ),
    "assessmentWorkOperator"
  );
  invariant(
    row.authorized === true,
    "OPERATOR_ACCESS_REQUIRED",
    "Assessment work tools are unavailable for this account.",
    { status: 403 }
  );
}

function databaseError(error) {
  if (error instanceof HostedError) return error;
  if (error?.code === "42501") {
    return new HostedError(
      "OPERATOR_ACCESS_REQUIRED",
      "Assessment work tools are unavailable for this account.",
      { status: 403 }
    );
  }
  if (
    [
      "22001",
      "22P02",
      "23502",
      "23503",
      "23505",
      "23514",
      "40001",
      "40P01",
      "55000"
    ].includes(error?.code)
  ) {
    return new HostedError(
      "ASSESSMENT_WORK_CHANGED",
      "That assessment work changed. Refresh before trying again.",
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

function evidenceReceipt(row) {
  return deepFreeze({
    schema: CUSTOM_SERVICES_OWNER_ASSESSMENT_EVIDENCE_SCHEMA,
    evidence: {
      evidenceId: row.id,
      jobId: row.job_id,
      reviewTarget: publicTarget(row.review_target),
      viewport: row.viewport,
      accessibleDescription: row.accessible_description,
      mediaType: row.media_type,
      byteCount: Number(row.byte_count),
      capturedAt: iso(row.captured_at)
    }
  });
}

function findingReceipt(row) {
  return deepFreeze({
    schema: CUSTOM_SERVICES_OWNER_ASSESSMENT_FINDING_SCHEMA,
    finding: {
      findingId: row.id,
      jobId: row.job_id,
      priority: Number(row.priority),
      included: row.included,
      severity: row.severity,
      category: row.category,
      primaryTarget: publicTarget(row.primary_target),
      viewports: [...row.viewports],
      summary: row.summary,
      recommendation: row.recommendation,
      evidenceIds: [...row.evidence_ids],
      revision: Number(row.revision),
      findingDigest: row.finding_digest,
      updatedAt: iso(row.updated_at)
    }
  });
}

function assessmentWorkDigest(jobId, evidence, findings) {
  return digest({
    schema: "sitesourcery.assessment-work-snapshot/v1",
    jobId,
    evidence: evidence.map((row) => ({
      evidenceId: row.id,
      reviewTarget: publicTarget(row.review_target),
      viewport: row.viewport,
      accessibleDescription: row.accessible_description,
      mediaType: row.media_type,
      byteCount: Number(row.byte_count),
      contentDigest: row.content_digest,
      capturedAt: iso(row.captured_at)
    })),
    findings: findings.map((row) => findingReceipt(row).finding)
  });
}

function creditProjection(row, now = Date.now()) {
  if (row.credit_id === null || row.credit_id === undefined) return null;
  const cutoff = iso(row.acceptance_cutoff);
  const applicationState = row.credit_application_state ?? null;
  invariant(
    applicationState === null ||
      ["reserved", "settled", "reconciliation_required"].includes(
        applicationState
      ),
    "assessment_work_repository_conflict",
    "The assessment credit application state is invalid.",
    { status: 500 }
  );
  return Object.freeze({
    creditId: row.credit_id,
    amountMinor: Number(row.amount_minor),
    currency: row.currency,
    applicationScope: "custom_base_build",
    eligibleTierIds: Object.freeze([...(row.eligible_tier_ids ?? [])]),
    maximumApplications: Number(row.maximum_applications),
    nonCash: row.non_cash === true,
    deliveredAt: iso(row.credit_delivered_at),
    acceptanceCutoff: cutoff,
    state:
      applicationState ??
      (Date.parse(cutoff) >= now ? "available" : "expired"),
    creditDigest: row.credit_digest
  });
}

function deliveryReceipt(row, now = Date.now()) {
  return deepFreeze({
    schema: CUSTOM_SERVICES_OWNER_ASSESSMENT_DELIVERY_SCHEMA,
    state: "delivered",
    jobId: row.job_id,
    reportId: row.report_id,
    deliveredAt: iso(row.delivered_at),
    overallSummary: row.overall_summary,
    findingCount: Number(row.finding_count),
    credit: creditProjection(row, now)
  });
}

function sameFinding(row, input) {
  return row !== null &&
    row.included === input.included &&
    row.severity === input.severity &&
    row.category === input.category &&
    row.primary_target === input.primaryTarget &&
    JSON.stringify(row.viewports) === JSON.stringify(input.viewports) &&
    row.summary === input.summary &&
    row.recommendation === input.recommendation &&
    JSON.stringify(row.evidence_ids) === JSON.stringify(input.evidenceIds);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function reportCredit(deliveredAt, cutoff) {
  return Object.freeze({
    amountMinor: 20000,
    currency: "USD",
    applicationScope: "custom_base_build",
    eligibleTierIds: [...ELIGIBLE_TIER_IDS],
    maximumApplications: 1,
    nonCash: true,
    sameOrganizationAndProjectOnly: true,
    deliveredAt,
    acceptanceCutoff: cutoff
  });
}

function exactReportDocument(value, expected) {
  exactKeys(
    value,
    [
      "buildCredit",
      "coverage",
      "deliveredAt",
      "findings",
      "jobId",
      "overallSummary",
      "project",
      "reportId",
      "schema",
      "scope"
    ],
    "assessmentReportDocument",
    { code: "assessment_work_repository_conflict", status: 500 }
  );
  invariant(
    value.schema === CUSTOM_SERVICES_ASSESSMENT_REPORT_DOCUMENT_SCHEMA &&
      value.reportId === expected.reportId &&
      value.jobId === expected.jobId &&
      value.project?.projectId === expected.projectId &&
      Array.isArray(value.coverage) &&
      Array.isArray(value.findings),
    "assessment_work_repository_conflict",
    "The delivered assessment report is invalid.",
    { status: 500 }
  );
  return deepFreeze(structuredClone(value));
}

function parseReportPayload(row) {
  const bytes = Buffer.from(row.payload);
  invariant(
    bytes.byteLength === Number(row.byte_count) &&
      sha256(bytes) === row.content_digest &&
      row.media_type === "application/json",
    "assessment_work_repository_conflict",
    "The delivered assessment report failed integrity verification.",
    { status: 500 }
  );
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    parsed = null;
  }
  return exactReportDocument(parsed, {
    reportId: row.report_id,
    jobId: row.job_id,
    projectId: row.project_id
  });
}

async function selectDelivered(client, organizationId, jobId) {
  return one(
    await client.query(
      `select
         report.id as report_id,
         report.job_id,
         report.delivered_at,
         report.overall_summary,
         report.finding_count,
         report.delivery_command_id,
         report.work_digest,
         report.delivery_digest,
         credit.id as credit_id,
         credit.amount_minor,
         credit.currency,
         credit.eligible_tier_ids,
         credit.maximum_applications,
         credit.non_cash,
         credit.delivered_at as credit_delivered_at,
         credit.acceptance_cutoff,
         credit.credit_digest,
         application.state as credit_application_state
       from ss.service_assessment_reports report
       join ss.service_credit_grants credit
         on credit.organization_id = report.organization_id
        and credit.source_report_id = report.id
       left join ss.service_credit_applications application
         on application.organization_id = credit.organization_id
        and application.credit_grant_id = credit.id
        and application.state in (
          'reserved', 'settled', 'reconciliation_required'
        )
      where report.organization_id = $1
        and report.job_id = $2`,
      [organizationId, jobId]
    ),
    "assessmentDelivery",
    { optional: true }
  );
}

function jobItem(job, evidence, findings, delivered, now) {
  return deepFreeze({
    jobId: job.job_id,
    organizationId: job.organization_id,
    organizationName: job.organization_name,
    projectId: job.project_id,
    projectName: job.project_name,
    caseId: job.case_id,
    customer: {
      customerId: job.customer_user_id,
      name: job.customer_name,
      email: job.customer_email
    },
    state: delivered ? "delivered" : "open",
    openedAt: iso(job.opened_at),
    deliveryDate: canonicalDate(job.delivery_date),
    workDigest: assessmentWorkDigest(job.job_id, evidence, findings),
    scope: {
      reviewTargets: job.review_targets.map(publicTarget),
      maximumWebsites: Number(job.maximum_websites),
      maximumRepresentativePagesOrTypes: Number(
        job.maximum_representative_pages_or_types
      ),
      maximumFindings: Number(job.maximum_findings),
      requiredViewports: ["desktop", "phone"]
    },
    evidence: evidence.map((row) => evidenceReceipt(row).evidence),
    findings: findings.map((row) => findingReceipt(row).finding),
    delivery: delivered ? deliveryReceipt(delivered, now) : null
  });
}

export function createHeldCustomServicesAssessmentWork() {
  function held(actor) {
    actorId(actor);
    throw new HostedError(
      "CUSTOM_SERVICES_ASSESSMENT_WORK_HELD",
      "Assessment work tools are held in this runtime.",
      { status: 503 }
    );
  }
  return Object.freeze({
    listJobs: held,
    uploadEvidence: held,
    putFinding: held,
    deliverReport: held,
    readOwnerEvidence: held,
    readCustomerReport: held,
    readCustomerEvidence: held
  });
}

export function createPostgresCustomServicesAssessmentWork({
  authority,
  clock = { now: () => new Date().toISOString() },
  randomUUID = systemRandomUUID
} = {}) {
  const database = validateAuthority(authority);
  invariant(
    clock && typeof clock.now === "function" && typeof randomUUID === "function",
    "invalid_configuration",
    "assessment work time and ID sources are required",
    { status: 500 }
  );

  return Object.freeze({
    async listJobs(actor) {
      const operatorUserId = actorId(actor);
      return translated(() =>
        database.service(
          { userId: operatorUserId, readOnly: true },
          async (client) => {
            await requireOperator(client, operatorUserId, "service_job_manage");
            const jobs = rows(
              await client.query(
                `select
                   job.id as job_id,
                   job.organization_id,
                   organization.name as organization_name,
                   job.project_id,
                   project.name as project_name,
                   job.case_id,
                   job.customer_user_id,
                   profile.display_name as customer_name,
                   account.email as customer_email,
                   job.review_targets,
                   job.maximum_websites,
                   job.maximum_representative_pages_or_types,
                   job.maximum_findings,
                   job.delivery_date,
                   job.opened_at
                 from ss.service_assessment_jobs job
                 join ss.organizations organization
                   on organization.id = job.organization_id
                 join ss.projects project
                   on project.organization_id = job.organization_id
                  and project.id = job.project_id
                 join auth.users account
                   on account.id = job.customer_user_id
                 join ss.hosted_account_profiles profile
                   on profile.user_id = job.customer_user_id
                order by
                  exists (
                    select 1 from ss.service_assessment_reports report
                     where report.job_id = job.id
                  ) asc,
                  job.delivery_date asc,
                  job.opened_at asc
                limit 100`
              ),
              "assessmentJobs"
            );
            if (jobs.length === 0) {
              return deepFreeze({
                schema: CUSTOM_SERVICES_OWNER_ASSESSMENT_JOBS_SCHEMA,
                jobs: []
              });
            }
            const jobIds = jobs.map((job) => job.job_id);
            const evidence = rows(
              await client.query(
                `select
                   evidence.id,
                   evidence.job_id,
                   evidence.review_target,
                   evidence.viewport,
                   evidence.accessible_description,
                   evidence.captured_at,
                   document.media_type,
                   document.byte_count,
                   document.content_digest
                 from ss.service_assessment_evidence evidence
                 join ss.service_documents document
                   on document.organization_id = evidence.organization_id
                  and document.id = evidence.document_id
                where evidence.job_id = any($1::uuid[])
                order by evidence.created_at asc, evidence.id asc`,
                [jobIds]
              ),
              "assessmentEvidence"
            );
            const findings = rows(
              await client.query(
                `select *
                   from ss.service_assessment_finding_drafts finding
                  where finding.job_id = any($1::uuid[])
                  order by finding.priority asc`,
                [jobIds]
              ),
              "assessmentFindings"
            );
            const deliveredRows = rows(
              await client.query(
                `select
                   report.id as report_id,
                   report.job_id,
                   report.delivered_at,
                   report.overall_summary,
                   report.finding_count,
                   credit.id as credit_id,
                   credit.amount_minor,
                   credit.currency,
                   credit.eligible_tier_ids,
                   credit.maximum_applications,
                   credit.non_cash,
                   credit.delivered_at as credit_delivered_at,
                   credit.acceptance_cutoff,
                   credit.credit_digest,
                   application.state as credit_application_state
                 from ss.service_assessment_reports report
                 join ss.service_credit_grants credit
                   on credit.organization_id = report.organization_id
                  and credit.source_report_id = report.id
                 left join ss.service_credit_applications application
                   on application.organization_id = credit.organization_id
                  and application.credit_grant_id = credit.id
                  and application.state in (
                    'reserved', 'settled', 'reconciliation_required'
                  )
                where report.job_id = any($1::uuid[])`,
                [jobIds]
              ),
              "assessmentDeliveries"
            );
            const evidenceByJob = Map.groupBy(evidence, (row) => row.job_id);
            const findingsByJob = Map.groupBy(findings, (row) => row.job_id);
            const deliveredByJob = new Map(
              deliveredRows.map((row) => [row.job_id, row])
            );
            const now = Date.parse(clock.now());
            return deepFreeze({
              schema: CUSTOM_SERVICES_OWNER_ASSESSMENT_JOBS_SCHEMA,
              jobs: jobs.map((job) =>
                jobItem(
                  job,
                  evidenceByJob.get(job.job_id) ?? [],
                  findingsByJob.get(job.job_id) ?? [],
                  deliveredByJob.get(job.job_id) ?? null,
                  now
                )
              )
            });
          }
        )
      );
    },

    async uploadEvidence(actor, jobIdInput, value) {
      const operatorUserId = actorId(actor);
      const jobId = uuid(jobIdInput, "jobId");
      const input = await evidenceInput(value);
      const contentDigest = sha256(input.bytes);
      const requestDigest = digest({
        route: "custom_services.owner.assessment_evidence.upload",
        operatorUserId,
        organizationId: input.organizationId,
        jobId,
        commandId: input.commandId,
        reviewTarget: input.reviewTarget,
        viewport: input.viewport,
        accessibleDescription: input.accessibleDescription,
        mediaType: input.mediaType,
        byteCount: input.bytes.byteLength,
        contentDigest
      });
      return translated(() =>
        database.service(
          {
            actorKind: "operator",
            userId: operatorUserId,
            organizationId: input.organizationId
          },
          async (client) => {
            await requireOperator(client, operatorUserId, "service_job_manage");
            await requireOperator(client, operatorUserId, "service_document_manage");
            await client.query(
              "select pg_advisory_xact_lock(hashtextextended($1, 0))",
              [`assessment-work:${input.organizationId}:${jobId}`]
            );
            const prior = one(
              await client.query(
                `select
                   evidence.id,
                   evidence.job_id,
                   evidence.review_target,
                   evidence.viewport,
                   evidence.accessible_description,
                   evidence.captured_at,
                   evidence.request_digest,
                   document.media_type,
                   document.byte_count
                 from ss.service_assessment_evidence evidence
                 join ss.service_documents document
                   on document.organization_id = evidence.organization_id
                  and document.id = evidence.document_id
                where evidence.created_by_operator_user_id = $1
                  and evidence.job_id = $2
                  and evidence.command_id = $3`,
                [operatorUserId, jobId, input.commandId]
              ),
              "priorAssessmentEvidence",
              { optional: true }
            );
            if (prior !== null) {
              invariant(
                prior.request_digest === requestDigest,
                "idempotency_conflict",
                "That evidence command was already used for different bytes or details.",
                { status: 409 }
              );
              return evidenceReceipt(prior);
            }

            const job = one(
              await client.query(
                `select organization_id, project_id, case_id
                   from ss.service_assessment_jobs
                  where organization_id = $1 and id = $2`,
                [input.organizationId, jobId]
              ),
              "assessmentJob"
            );
            const evidenceId = uuid(randomUUID(), "generated evidence ID");
            const documentId = uuid(randomUUID(), "generated document ID");
            const capturedAt = iso(clock.now(), "capturedAt");
            const objectKey = [
              "service-documents",
              input.organizationId,
              job.project_id,
              jobId,
              `${documentId}.${MEDIA_EXTENSIONS[input.mediaType]}`
            ].join("/");
            await client.query(
              `insert into ss.service_documents (
                 id, organization_id, project_id, case_id, document_kind,
                 object_key, content_digest, media_type, byte_count,
                 visibility, retention_class, created_by_kind,
                 created_by_user_id, created_at
               ) values (
                 $1, $2, $3, $4, 'assessment_evidence', $5, $6, $7, $8,
                 'customer', 'project', 'operator', $9, clock_timestamp()
               )`,
              [
                documentId,
                input.organizationId,
                job.project_id,
                job.case_id,
                objectKey,
                contentDigest,
                input.mediaType,
                input.bytes.byteLength,
                operatorUserId
              ]
            );
            await client.query(
              `insert into ss.service_document_payloads (
                 organization_id, document_id, media_type, payload
               ) values ($1, $2, $3, $4)`,
              [
                input.organizationId,
                documentId,
                input.mediaType,
                input.bytes
              ]
            );
            const inserted = one(
              await client.query(
                `insert into ss.service_assessment_evidence (
                   id, organization_id, project_id, case_id, job_id,
                   document_id, review_target, viewport,
                   accessible_description, command_id, request_digest,
                   created_by_operator_user_id, captured_at, created_at
                 ) values (
                   $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                   $12, $13::timestamptz, clock_timestamp()
                 )
                 returning
                   id, job_id, review_target, viewport,
                   accessible_description, captured_at`,
                [
                  evidenceId,
                  input.organizationId,
                  job.project_id,
                  job.case_id,
                  jobId,
                  documentId,
                  input.reviewTarget,
                  input.viewport,
                  input.accessibleDescription,
                  input.commandId,
                  requestDigest,
                  operatorUserId,
                  capturedAt
                ]
              ),
              "newAssessmentEvidence"
            );
            return evidenceReceipt({
              ...inserted,
              media_type: input.mediaType,
              byte_count: input.bytes.byteLength
            });
          }
        )
      );
    },

    async putFinding(actor, jobIdInput, priorityInput, value) {
      const operatorUserId = actorId(actor);
      const jobId = uuid(jobIdInput, "jobId");
      const priority = integer(priorityInput, "priority", 1, 10);
      const input = findingInput(value);
      return translated(() =>
        database.service(
          {
            actorKind: "operator",
            userId: operatorUserId,
            organizationId: input.organizationId
          },
          async (client) => {
            await requireOperator(client, operatorUserId, "service_job_manage");
            await client.query(
              "select pg_advisory_xact_lock(hashtextextended($1, 0))",
              [`assessment-work:${input.organizationId}:${jobId}`]
            );
            const job = one(
              await client.query(
                `select organization_id, project_id, case_id
                   from ss.service_assessment_jobs
                  where organization_id = $1 and id = $2`,
                [input.organizationId, jobId]
              ),
              "assessmentJob"
            );
            const current = one(
              await client.query(
                `select *
                   from ss.service_assessment_finding_drafts
                  where organization_id = $1
                    and job_id = $2
                    and priority = $3
                  for update`,
                [input.organizationId, jobId, priority]
              ),
              "assessmentFinding",
              { optional: true }
            );
            if (
              current !== null &&
              Number(current.revision) === input.expectedRevision + 1 &&
              sameFinding(current, input)
            ) {
              return findingReceipt(current);
            }
            invariant(
              current === null
                ? input.expectedRevision === 0
                : Number(current.revision) === input.expectedRevision,
              "ASSESSMENT_FINDING_CHANGED",
              "That finding changed. Refresh it before saving.",
              { status: 409 }
            );

            let saved;
            if (current === null) {
              saved = one(
                await client.query(
                  `insert into ss.service_assessment_finding_drafts (
                     id, organization_id, project_id, case_id, job_id,
                     priority, included, severity, category, primary_target,
                     viewports, summary, recommendation, evidence_ids,
                     revision, finding_digest,
                     created_by_operator_user_id, created_at, updated_at
                   ) values (
                     $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                     $11::text[], $12, $13, $14::uuid[], 1,
                     $15, $16, clock_timestamp(), clock_timestamp()
                   ) returning *`,
                  [
                    uuid(randomUUID(), "generated finding ID"),
                    input.organizationId,
                    job.project_id,
                    job.case_id,
                    jobId,
                    priority,
                    input.included,
                    input.severity,
                    input.category,
                    input.primaryTarget,
                    [...input.viewports],
                    input.summary,
                    input.recommendation,
                    [...input.evidenceIds],
                    "0".repeat(64),
                    operatorUserId
                  ]
                ),
                "newAssessmentFinding"
              );
            } else {
              saved = one(
                await client.query(
                  `update ss.service_assessment_finding_drafts
                      set included = $4,
                          severity = $5,
                          category = $6,
                          primary_target = $7,
                          viewports = $8::text[],
                          summary = $9,
                          recommendation = $10,
                          evidence_ids = $11::uuid[]
                    where organization_id = $1
                      and job_id = $2
                      and priority = $3
                    returning *`,
                  [
                    input.organizationId,
                    jobId,
                    priority,
                    input.included,
                    input.severity,
                    input.category,
                    input.primaryTarget,
                    [...input.viewports],
                    input.summary,
                    input.recommendation,
                    [...input.evidenceIds]
                  ]
                ),
                "updatedAssessmentFinding"
              );
            }
            return findingReceipt(saved);
          }
        )
      );
    },

    async deliverReport(actor, jobIdInput, value) {
      const operatorUserId = actorId(actor);
      const jobId = uuid(jobIdInput, "jobId");
      const input = deliveryInput(value);
      return translated(() =>
        database.service(
          {
            actorKind: "operator",
            userId: operatorUserId,
            organizationId: input.organizationId
          },
          async (client) => {
            await requireOperator(client, operatorUserId, "service_job_manage");
            await requireOperator(client, operatorUserId, "service_document_manage");
            await client.query(
              "select pg_advisory_xact_lock(hashtextextended($1, 0))",
              [`assessment-work:${input.organizationId}:${jobId}`]
            );
            const job = one(
              await client.query(
                `select
                   job.*,
                   project.name as project_name,
                   organization.name as organization_name
                 from ss.service_assessment_jobs job
                 join ss.projects project
                   on project.organization_id = job.organization_id
                  and project.id = job.project_id
                join ss.organizations organization
                   on organization.id = job.organization_id
                where job.organization_id = $1 and job.id = $2`,
                [input.organizationId, jobId]
              ),
              "assessmentJob"
            );
            const allEvidenceRows = rows(
              await client.query(
                `select
                   evidence.id,
                   evidence.review_target,
                   evidence.viewport,
                   evidence.accessible_description,
                   evidence.captured_at,
                   evidence.created_at,
                   document.media_type,
                   document.byte_count,
                   document.content_digest
                 from ss.service_assessment_evidence evidence
                 join ss.service_documents document
                   on document.organization_id = evidence.organization_id
                  and document.id = evidence.document_id
                where evidence.organization_id = $1
                  and evidence.job_id = $2
                order by evidence.created_at asc, evidence.id asc`,
                [input.organizationId, jobId]
              ),
              "assessmentEvidence"
            );
            const allFindings = rows(
              await client.query(
                `select *
                   from ss.service_assessment_finding_drafts finding
                  where finding.organization_id = $1
                    and finding.job_id = $2
                  order by finding.priority asc`,
                [input.organizationId, jobId]
              ),
              "assessmentFindings"
            );
            const workDigest = assessmentWorkDigest(
              jobId,
              allEvidenceRows,
              allFindings
            );
            invariant(
              workDigest === input.expectedWorkDigest,
              "ASSESSMENT_WORK_CHANGED",
              "That assessment work changed. Refresh and review it before delivery.",
              { status: 409 }
            );
            const deliveryDigest = digest({
              schema: "sitesourcery.assessment-delivery-command/v1",
              operatorUserId,
              organizationId: input.organizationId,
              jobId,
              workDigest,
              overallSummary: input.overallSummary
            });
            const prior = await selectDelivered(
              client,
              input.organizationId,
              jobId
            );
            if (prior !== null) {
              invariant(
                prior.work_digest === workDigest &&
                  prior.delivery_digest === deliveryDigest,
                "ASSESSMENT_ALREADY_DELIVERED",
                "That assessment was already delivered from different reviewed work or summary.",
                { status: 409 }
              );
              return deliveryReceipt(prior, Date.parse(clock.now()));
            }

            const latestCoverage = new Map();
            for (const entry of allEvidenceRows) {
              latestCoverage.set(
                `${entry.review_target}\u0000${entry.viewport}`,
                entry
              );
            }
            const evidence = [...latestCoverage.values()];
            const expectedCoverage = job.review_targets.length * 2;
            invariant(
              evidence.length === expectedCoverage &&
                job.review_targets.every((reviewTarget) =>
                  ["desktop", "phone"].every((requiredViewport) =>
                    evidence.some((entry) =>
                      entry.review_target === reviewTarget &&
                      entry.viewport === requiredViewport
                    )
                  )
                ),
              "ASSESSMENT_COVERAGE_INCOMPLETE",
              "Every paid review target needs both desktop and phone screenshot evidence before delivery.",
              { status: 409 }
            );
            const findings = allFindings.filter((finding) => finding.included);
            invariant(
              findings.length <= 10 &&
                findings.every((finding, index) =>
                  Number(finding.priority) === index + 1
                ),
              "ASSESSMENT_FINDING_ORDER_INCOMPLETE",
              "Included findings must use consecutive priorities beginning at one.",
              { status: 409 }
            );
            const evidenceById = new Map(
              allEvidenceRows.map((entry) => [entry.id, entry])
            );

            const requestedDeliveryTime = iso(clock.now(), "deliveredAt");
            const deliveryTiming = one(
              await client.query(
                `select
                   $1::timestamptz as delivered_at,
                   $1::timestamptz + interval '90 days' as acceptance_cutoff`,
                [requestedDeliveryTime]
              ),
              "assessmentDeliveryTiming"
            );
            const deliveredAt = iso(deliveryTiming.delivered_at);
            const acceptanceCutoff = iso(deliveryTiming.acceptance_cutoff);
            const reportId = uuid(randomUUID(), "generated report ID");
            const documentId = uuid(randomUUID(), "generated report document ID");
            const report = deepFreeze({
              schema: CUSTOM_SERVICES_ASSESSMENT_REPORT_DOCUMENT_SCHEMA,
              reportId,
              jobId,
              project: {
                organizationId: input.organizationId,
                organizationName: job.organization_name,
                projectId: job.project_id,
                projectName: job.project_name
              },
              deliveredAt,
              scope: {
                maximumWebsites: 1,
                reviewTargets: job.review_targets.map(publicTarget),
                requiredViewports: ["desktop", "phone"],
                maximumFindings: 10,
                expandedAssessmentState: "separately_quoted"
              },
              overallSummary: input.overallSummary,
              coverage: evidence.map((entry) => ({
                evidenceId: entry.id,
                reviewTarget: publicTarget(entry.review_target),
                viewport: entry.viewport,
                accessibleDescription: entry.accessible_description,
                capturedAt: iso(entry.captured_at),
                url:
                  `/api/v1/projects/${job.project_id}` +
                  `/custom-services/assessment-evidence/${entry.id}`
              })),
              findings: findings.map((finding) => ({
                findingId: finding.id,
                revision: Number(finding.revision),
                findingDigest: finding.finding_digest,
                priority: Number(finding.priority),
                severity: finding.severity,
                category: finding.category,
                primaryTarget: publicTarget(finding.primary_target),
                viewports: [...finding.viewports],
                summary: finding.summary,
                recommendation: finding.recommendation,
                evidence: finding.evidence_ids.map((evidenceId) => {
                  const selected = evidenceById.get(evidenceId);
                  invariant(
                    selected,
                    "assessment_work_repository_conflict",
                    "Finding evidence disappeared before delivery.",
                    { status: 500 }
                  );
                  return {
                    evidenceId,
                    viewport: selected.viewport,
                    accessibleDescription: selected.accessible_description,
                    url:
                      `/api/v1/projects/${job.project_id}` +
                      `/custom-services/assessment-evidence/${evidenceId}`
                  };
                })
              })),
              buildCredit: reportCredit(deliveredAt, acceptanceCutoff)
            });
            const bytes = Buffer.from(JSON.stringify(report), "utf8");
            invariant(
              bytes.byteLength > 0 && bytes.byteLength <= MAXIMUM_REPORT_BYTES,
              "ASSESSMENT_REPORT_TOO_LARGE",
              "The assessment report is too large to deliver safely.",
              { status: 409 }
            );
            const contentDigest = sha256(bytes);
            const objectKey = [
              "service-documents",
              input.organizationId,
              job.project_id,
              jobId,
              `${documentId}.json`
            ].join("/");
            await client.query(
              `insert into ss.service_documents (
                 id, organization_id, project_id, case_id, document_kind,
                 object_key, content_digest, media_type, byte_count,
                 visibility, retention_class, created_by_kind,
                 created_by_user_id, created_at
               ) values (
                 $1, $2, $3, $4, 'assessment_report', $5, $6,
                 'application/json', $7, 'customer', 'project',
                 'operator', $8, $9::timestamptz
               )`,
              [
                documentId,
                input.organizationId,
                job.project_id,
                job.case_id,
                objectKey,
                contentDigest,
                bytes.byteLength,
                operatorUserId,
                deliveredAt
              ]
            );
            await client.query(
              `insert into ss.service_document_payloads (
                 organization_id, document_id, media_type, payload, created_at
               ) values ($1, $2, 'application/json', $3, $4::timestamptz)`,
              [input.organizationId, documentId, bytes, deliveredAt]
            );
            await client.query(
              `insert into ss.service_assessment_reports (
                 id, organization_id, project_id, case_id, customer_user_id,
                 job_id, payment_receipt_id, document_id, report_schema,
                 overall_summary, review_target_count, finding_count,
                 delivered_by_operator_user_id, delivery_command_id,
                 work_digest, delivery_digest, delivered_at,
                 build_credit_acceptance_cutoff, created_at
               ) values (
                 $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                 $11, $12, $13, $14, $15, $16, $17::timestamptz,
                 $18::timestamptz, $17::timestamptz
               )`,
              [
                reportId,
                input.organizationId,
                job.project_id,
                job.case_id,
                job.customer_user_id,
                jobId,
                job.payment_receipt_id,
                documentId,
                CUSTOM_SERVICES_ASSESSMENT_REPORT_DOCUMENT_SCHEMA,
                input.overallSummary,
                job.review_targets.length,
                findings.length,
                operatorUserId,
                input.commandId,
                workDigest,
                deliveryDigest,
                deliveredAt,
                acceptanceCutoff
              ]
            );
            const delivered = await selectDelivered(
              client,
              input.organizationId,
              jobId
            );
            invariant(
              delivered !== null,
              "assessment_work_repository_conflict",
              "Assessment delivery did not create its report and credit.",
              { status: 500 }
            );
            return deliveryReceipt(delivered, Date.parse(deliveredAt));
          }
        )
      );
    },

    async readOwnerEvidence(actor, jobIdInput, evidenceIdInput) {
      const operatorUserId = actorId(actor);
      const jobId = uuid(jobIdInput, "jobId");
      const evidenceId = uuid(evidenceIdInput, "evidenceId");
      return translated(() =>
        database.service(
          { userId: operatorUserId, readOnly: true },
          async (client) => {
            await requireOperator(client, operatorUserId, "service_job_manage");
            await requireOperator(client, operatorUserId, "service_document_manage");
            const row = one(
              await client.query(
                `select
                   evidence.accessible_description,
                   document.media_type,
                   document.content_digest,
                   document.byte_count,
                   payload.payload
                 from ss.service_assessment_evidence evidence
                 join ss.service_documents document
                   on document.organization_id = evidence.organization_id
                  and document.id = evidence.document_id
                 join ss.service_document_payloads payload
                   on payload.organization_id = document.organization_id
                  and payload.document_id = document.id
                where evidence.job_id = $1 and evidence.id = $2`,
                [jobId, evidenceId]
              ),
              "assessmentEvidence"
            );
            const bytes = Buffer.from(row.payload);
            invariant(
              bytes.byteLength === Number(row.byte_count) &&
                sha256(bytes) === row.content_digest,
              "assessment_work_repository_conflict",
              "Assessment evidence failed integrity verification.",
              { status: 500 }
            );
            return Object.freeze({
              bytes,
              mediaType: row.media_type,
              contentDigest: row.content_digest,
              byteCount: Number(row.byte_count),
              accessibleDescription: row.accessible_description
            });
          }
        )
      );
    },

    async readCustomerReport(scope) {
      exactKeys(
        scope,
        ["actorId", "customerId", "organizationId", "projectId"],
        "assessmentCustomerScope"
      );
      const customerId = uuid(scope.customerId, "customerId");
      invariant(
        uuid(scope.actorId, "actorId") === customerId,
        "project_unavailable",
        "the assessment project is unavailable",
        { status: 404 }
      );
      const organizationId = uuid(scope.organizationId, "organizationId");
      const projectId = uuid(scope.projectId, "projectId");
      return translated(() =>
        database.service(
          { userId: customerId, readOnly: true },
          async (client) => {
            const job = one(
              await client.query(
                `select *
                   from ss.service_assessment_jobs job
                  where job.organization_id = $1
                    and job.project_id = $2
                    and job.customer_user_id = $3`,
                [organizationId, projectId, customerId]
              ),
              "customerAssessmentJob",
              { optional: true }
            );
            if (job === null) {
              return deepFreeze({
                schema: CUSTOM_SERVICES_CUSTOMER_ASSESSMENT_REPORT_SCHEMA,
                state: "not_available",
                job: null,
                report: null,
                credit: null
              });
            }
            const reportRow = one(
              await client.query(
                `select
                   report.id as report_id,
                   report.job_id,
                   report.project_id,
                   report.delivered_at,
                   document.media_type,
                   document.content_digest,
                   document.byte_count,
                   payload.payload,
                   credit.id as credit_id,
                   credit.amount_minor,
                   credit.currency,
                   credit.eligible_tier_ids,
                   credit.maximum_applications,
                   credit.non_cash,
                   credit.delivered_at as credit_delivered_at,
                   credit.acceptance_cutoff,
                   credit.credit_digest,
                   application.state as credit_application_state
                 from ss.service_assessment_reports report
                 join ss.service_documents document
                   on document.organization_id = report.organization_id
                  and document.id = report.document_id
                 join ss.service_document_payloads payload
                   on payload.organization_id = document.organization_id
                  and payload.document_id = document.id
                 join ss.service_credit_grants credit
                   on credit.organization_id = report.organization_id
                  and credit.source_report_id = report.id
                 left join ss.service_credit_applications application
                   on application.organization_id = credit.organization_id
                  and application.credit_grant_id = credit.id
                  and application.state in (
                    'reserved', 'settled', 'reconciliation_required'
                  )
                where report.organization_id = $1
                  and report.project_id = $2
                  and report.customer_user_id = $3`,
                [organizationId, projectId, customerId]
              ),
              "customerAssessmentReport",
              { optional: true }
            );
            const safeJob = Object.freeze({
              jobId: job.id,
              state: reportRow === null ? "open" : "delivered",
              openedAt: iso(job.opened_at),
              deliveryDate: canonicalDate(job.delivery_date),
              scope: {
                reviewTargets: job.review_targets.map(publicTarget),
                requiredViewports: ["desktop", "phone"],
                maximumFindings: Number(job.maximum_findings)
              }
            });
            if (reportRow === null) {
              return deepFreeze({
                schema: CUSTOM_SERVICES_CUSTOMER_ASSESSMENT_REPORT_SCHEMA,
                state: "in_progress",
                job: safeJob,
                report: null,
                credit: null
              });
            }
            return deepFreeze({
              schema: CUSTOM_SERVICES_CUSTOMER_ASSESSMENT_REPORT_SCHEMA,
              state: "delivered",
              job: safeJob,
              report: parseReportPayload(reportRow),
              credit: creditProjection(reportRow, Date.parse(clock.now()))
            });
          }
        )
      );
    },

    async readCustomerEvidence(scope, evidenceIdInput) {
      exactKeys(
        scope,
        ["actorId", "customerId", "organizationId", "projectId"],
        "assessmentCustomerScope"
      );
      const customerId = uuid(scope.customerId, "customerId");
      invariant(
        uuid(scope.actorId, "actorId") === customerId,
        "project_unavailable",
        "the assessment project is unavailable",
        { status: 404 }
      );
      const organizationId = uuid(scope.organizationId, "organizationId");
      const projectId = uuid(scope.projectId, "projectId");
      const evidenceId = uuid(evidenceIdInput, "evidenceId");
      return translated(() =>
        database.service(
          { userId: customerId, readOnly: true },
          async (client) => {
            const reportRow = one(
              await client.query(
                `select
                   report.id as report_id,
                   report.job_id,
                   report.project_id,
                   report_payload.payload,
                   report_document.media_type,
                   report_document.content_digest,
                   report_document.byte_count
                 from ss.service_assessment_reports report
                 join ss.service_documents report_document
                   on report_document.organization_id = report.organization_id
                  and report_document.id = report.document_id
                 join ss.service_document_payloads report_payload
                   on report_payload.organization_id = report_document.organization_id
                  and report_payload.document_id = report_document.id
                where report.organization_id = $1
                  and report.project_id = $2
                  and report.customer_user_id = $3`,
                [organizationId, projectId, customerId]
              ),
              "customerAssessmentReport"
            );
            const report = parseReportPayload(reportRow);
            const exposed =
              report.coverage.some((entry) => entry.evidenceId === evidenceId) ||
              report.findings.some((finding) =>
                finding.evidence.some((entry) => entry.evidenceId === evidenceId)
              );
            invariant(
              exposed,
              "ASSESSMENT_EVIDENCE_UNAVAILABLE",
              "That assessment evidence is unavailable.",
              { status: 404 }
            );
            const row = one(
              await client.query(
                `select
                   evidence.accessible_description,
                   document.media_type,
                   document.content_digest,
                   document.byte_count,
                   payload.payload
                 from ss.service_assessment_evidence evidence
                 join ss.service_documents document
                   on document.organization_id = evidence.organization_id
                  and document.id = evidence.document_id
                 join ss.service_document_payloads payload
                   on payload.organization_id = document.organization_id
                  and payload.document_id = document.id
                where evidence.organization_id = $1
                  and evidence.project_id = $2
                  and evidence.id = $3`,
                [organizationId, projectId, evidenceId]
              ),
              "customerAssessmentEvidence"
            );
            const bytes = Buffer.from(row.payload);
            invariant(
              bytes.byteLength === Number(row.byte_count) &&
                sha256(bytes) === row.content_digest,
              "assessment_work_repository_conflict",
              "Assessment evidence failed integrity verification.",
              { status: 500 }
            );
            return Object.freeze({
              bytes,
              mediaType: row.media_type,
              contentDigest: row.content_digest,
              byteCount: Number(row.byte_count),
              accessibleDescription: row.accessible_description
            });
          }
        )
      );
    }
  });
}
