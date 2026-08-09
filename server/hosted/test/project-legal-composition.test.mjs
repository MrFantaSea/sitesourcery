import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createHostedApi } from "../http.mjs";
import { digestUserAgent } from "../project-legal-authority.mjs";
import { createCanonicalPostgresAuthority } from "../repository-postgres.mjs";

const ORIGIN = "https://app.sitesourcery.test";
const SESSION = "session_customer_1";
const CSRF = "c".repeat(43);

test("production bootstrap injects the single fail-closed legal authority handoff", async () => {
  const source = await readFile(
    new URL("../bin/server.mjs", import.meta.url),
    "utf8"
  );
  assert.match(
    source,
    /createProjectLegalAuthorityFromEnvironment\(\)/u
  );
  assert.match(
    source,
    /projectLegalAuthority:\s*projectLegalAuthorityConfig\.authority,/u
  );
  assert.match(
    source,
    /projectLegalAuthorityDiagnostic:\s*projectLegalAuthorityConfig\.diagnostic,/u
  );
  assert.doesNotMatch(
    source,
    /SS-HOSTED-PRIVACY-20\d\d-\d\d-\d\d-V3/u
  );
});

test("project legal backend preserves V2 history and binds idempotency to the exact acceptance", async () => {
  const source = await readFile(
    new URL("../postgres-service.mjs", import.meta.url),
    "utf8"
  );
  assert.match(source, /purpose:\s*\{[\s\S]*legalAcceptance/u);
  assert.match(source, /project_required_terms/u);
  assert.doesNotMatch(source, /document\.content_uri as evidence_uri/u);
  assert.match(source, /evidenceUri:\s*evidence\.get\(row\.document_id\) \?\? null/u);
  assert.match(source, /left join ss\.legal_document_artifacts/u);
  assert.match(source, /for update of document/u);
  assert.match(source, /\$1::text, \$2::text[\s\S]*\$5::text, \$6::text/u);
  assert.match(source, /legalAuthority\.artifactBindings/u);
});

test("ready project creation records only the User-Agent digest and ignores forwarded IP", async () => {
  const calls = [];
  const service = {
    async authenticate(token) {
      return token === SESSION
        ? { userId: "00000000-0000-4000-8000-000000000001" }
        : null;
    },
    async projectCreationLegalReadiness() {
      return true;
    },
    async createProject(actor, organizationId, input) {
      calls.push({ actor, organizationId, input });
      return {
        project: { id: "00000000-0000-4000-8000-000000000003" }
      };
    }
  };
  let requestSequence = 0;
  const api = createHostedApi(service, {
    requestIds: {
      next() {
        requestSequence += 1;
        return `request_${requestSequence}`;
      }
    },
    csrfTokens() {
      return CSRF;
    }
  });
  const userAgent = "Privacy-V3-UA-Proof/1.0";
  const response = await api.fetch(new Request(
    `${ORIGIN}/api/v1/organizations/00000000-0000-4000-8000-000000000002/projects`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `ss_session=${SESSION}; ss_csrf=${CSRF}`,
        "Idempotency-Key": "privacy-v3-http-proof",
        Origin: ORIGIN,
        "User-Agent": userAgent,
        "X-CSRF-Token": CSRF,
        "X-Forwarded-For": "203.0.113.99"
      },
      body: JSON.stringify({
        name: "Evidence boundary",
        legalAcceptance: {
          schema: "sitesourcery.project-legal-acceptance/v3",
          acceptanceStatement:
            "accepted_exact_project_terms_and_acknowledged_privacy",
          authorityDigest: "a".repeat(64),
          documents: []
        }
      })
    }
  ));

  assert.equal(response.status, 201);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input.userAgentDigest, digestUserAgent(userAgent));
  assert.equal("ipAddress" in calls[0].input, false);
  assert.equal("forwardedFor" in calls[0].input, false);
});

test("project legal readiness differentiates catalog and data proof with exact trigger relations", async () => {
  const calls = [];
  const pool = {
    async query(text, values = []) {
      calls.push({ text, values });
      if (text.includes("current_database() as database_name")) {
        return {
          rows: [{
            database_name: "sitesourcery",
            shadow_schema_absent: true,
            custom_services_schema_ready: true,
            custom_service_quotes_schema_ready: true
          }],
          rowCount: 1
        };
      }
      if (text.includes("v48_catalog_immutability_triggers")) {
        const exactRequiredTerms =
          text.includes(
            "('project_required_terms_no_delete_v48', 'project_required_terms', 'ss.reject_delete_v48()', 11, false, false)"
          ) &&
          text.includes(
            "('project_required_terms_monotonic_v48', 'project_required_terms', 'ss.validate_project_required_term_monotonicity()', 19, false, false)"
          );
        return {
          rows: [{
            v48_catalog_contract: true,
            v48_catalog_tables: true,
            v48_catalog_receipt_columns: true,
            v48_catalog_artifact_columns: true,
            v48_catalog_immutability_triggers: exactRequiredTerms,
            v48_catalog_rls: true,
            v48_catalog_receipt_constraints:
              text.includes("term_acceptances") &&
              text.includes("legal_receipt_id"),
            v48_catalog_artifact_constraints: true,
            v48_catalog_policies: true,
            v48_catalog_privileges: true
          }],
          rowCount: 1
        };
      }
      if (
        text.includes("as v2_artifact_ready") &&
        text.includes("as v3_artifact_ready")
      ) {
        return {
          rows: [{
            contract_marker_ready: true,
            v2_artifact_ready:
              text.includes("00000000-0000-4000-8000-000000000022") &&
              text.includes("00000000-0000-4000-8000-000000000023") &&
              text.includes("SS-HOSTED-PRIVACY-2026-07-30-V2") &&
              text.includes("SS-HOSTED-WEBSITE-TERMS-2026-07-30-V2") &&
              text.includes("b57979f99f7176b7d83d7d9efad9893fb87605c2f51511ced79982675f98a06b") &&
              text.includes("bd710c536d2b2c1b8d056efecc8930f98147566ab16d5919382ed10518fe2196") &&
              text.includes("19935"),
            v3_artifact_ready: true,
            authority_ready: true
          }],
          rowCount: 1
        };
      }
      if (text.includes("as exact_artifacts_ready")) {
        return {
          rows: [{
            contract_marker_ready: true,
            exact_documents_ready: true,
            exact_artifacts_ready: false,
            authority_digest_ready: true
          }],
          rowCount: 1
        };
      }
      return { rows: [{}], rowCount: 1 };
    },
    async connect() {
      throw new Error("readiness must not open a transaction");
    }
  };
  const authority = createCanonicalPostgresAuthority({ pool });
  const readiness = await authority.readiness();

  assert.equal(readiness.ready, true);
  assert.equal(readiness.projectCreationLegal.ready, true);
  assert.equal(
    await authority.projectLegalAuthorityMatches({
      schema: "sitesourcery.project-legal-authority/v3",
      documents: [
        {
          kind: "privacy",
          version: "SS-HOSTED-PRIVACY-TEST-V3",
          contentDigest: "a".repeat(64),
          contentUri: "https://example.test/privacy/v3",
          effectiveAt: "2026-08-08T00:00:00.000Z"
        },
        {
          kind: "product",
          version: "SS-HOSTED-WEBSITE-TERMS-TEST-V3",
          contentDigest: "b".repeat(64),
          contentUri: "https://example.test/terms/#self-service",
          effectiveAt: "2026-08-08T00:00:00.000Z"
        },
        {
          kind: "website",
          version: "SS-HOSTED-WEBSITE-TERMS-TEST-V3",
          contentDigest: "b".repeat(64),
          contentUri: "https://example.test/terms/",
          effectiveAt: "2026-08-08T00:00:00.000Z"
        }
      ],
      documentBindings: [
        { id: "00000000-0000-4000-8000-000000000048" },
        { id: "00000000-0000-4000-8000-000000000103" },
        { id: "00000000-0000-4000-8000-000000000104" }
      ],
      artifactBindings: [
        {
          artifactUri: "https://example.test/privacy/v3.html",
          artifactSha256: "a".repeat(64),
          byteCount: 1234,
          mediaType: "text/html; charset=utf-8"
        },
        { artifactUri: null },
        {
          artifactUri: "https://example.test/terms/v3.html",
          artifactSha256: "b".repeat(64),
          byteCount: 2345,
          mediaType: "text/html; charset=utf-8"
        }
      ],
      authorityDigest: "c".repeat(64)
    }),
    false
  );
  assert.equal(
    calls.filter(({ text }) =>
      text.includes("v48_catalog_immutability_triggers")
    ).length,
    2
  );
  assert.equal(
    calls.filter(({ text }) => text.includes("as v2_artifact_ready")).length,
    2
  );
  const catalogQuery = calls.find(({ text }) =>
    text.includes("v48_catalog_immutability_triggers")
  ).text;
  assert.match(catalogQuery, /select count\(\*\) = 14/u);
  assert.match(
    catalogQuery,
    /'term_acceptance_legal_receipt_exact_bundle', 'term_acceptances', 'ss\.validate_project_legal_acceptance_receipt\(\)', 5, true, true/u
  );
  assert.match(catalogQuery, /select count\(\*\) = 7/u);
  assert.match(catalogQuery, /select count\(\*\) = 5/u);
  assert.match(catalogQuery, /select count\(\*\) = 3/u);
  assert.match(catalogQuery, /attribute_row\.atttypid = to_regtype\('ss\.sha256_hex'\)/u);
  assert.match(catalogQuery, /attribute_row\.attgenerated = ''/u);
  assert.match(catalogQuery, /attribute_row\.attidentity = ''/u);
  assert.match(catalogQuery, /attribute_row\.attname = 'legal_receipt_id'/u);
  assert.match(catalogQuery, /relation\.relname = 'term_acceptances'[\s\S]*select count\(\*\) = 7/u);
  assert.match(catalogQuery, /coalesce\([\s\S]*trigger_row\.tgfoid/u);
  assert.match(catalogQuery, /not privilege\.is_grantable/u);
  assert.match(catalogQuery, /procedure_row\.proowner[\s\S]*select count\(\*\) = 1/u);
  assert.match(catalogQuery, /hosted_runtime_contract_v53\(\)/u);
  assert.match(catalogQuery, /project-legal-acceptance\/v4/u);
  assert.match(catalogQuery, /attribute_row\.attacl is not null/u);
  assert.match(catalogQuery, /'REFERENCES'/u);
  assert.match(catalogQuery, /'TRIGGER'/u);
  const dataQuery = calls.find(({ text }) =>
    text.includes("as v2_artifact_ready")
  ).text;
  assert.match(dataQuery, /00000000-0000-4000-8000-000000000022/u);
  assert.match(dataQuery, /00000000-0000-4000-8000-000000000023/u);
  assert.match(dataQuery, /00000000-0000-4000-8000-000000000104/u);
  assert.match(
    dataQuery,
    /artifact\.document_id =\s*'00000000-0000-4000-8000-000000000103'::uuid/u
  );
  const constantsQuery = calls.find(({ text }) =>
    text.includes("as exact_artifacts_ready")
  ).text;
  assert.match(
    constantsQuery,
    /artifact\.document_id in \(\$1::uuid, \$7::uuid, \$13::uuid\)/u
  );
  assert.match(constantsQuery, /select count\(\*\) = 2/u);
  assert.match(constantsQuery, /artifact\.document_id = \$24::uuid/u);
  assert.match(constantsQuery, /'schema', \$29::text/u);
  assert.match(constantsQuery, /\)\) = \$30::text as authority_digest_ready/u);
  const constantsCall = calls.find(({ text }) =>
    text.includes("as exact_artifacts_ready")
  );
  assert.equal(constantsCall.values.length, 30);
  assert.equal(constantsCall.values[18], "00000000-0000-4000-8000-000000000048");
  assert.equal(constantsCall.values[23], "00000000-0000-4000-8000-000000000104");
  assert.equal(constantsCall.values[28], "sitesourcery.project-legal-authority/v3");
  assert.equal(constantsCall.values[29], "c".repeat(64));
});
