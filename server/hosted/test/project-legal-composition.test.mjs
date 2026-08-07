import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("production bootstrap injects the single fail-closed legal authority handoff", async () => {
  const source = await readFile(
    new URL("../bin/server.mjs", import.meta.url),
    "utf8"
  );
  assert.match(
    source,
    /createProjectLegalAuthorityFromEnvironment\(\)/u
  );
  assert.match(source, /projectLegalAuthority,/u);
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
  assert.match(source, /document\.content_uri as evidence_uri/u);
  assert.match(source, /left join ss\.legal_document_artifacts/u);
  assert.match(source, /for update of document/u);
  assert.match(source, /\$1::text, \$2::text[\s\S]*\$5::text, \$6::text/u);
  assert.match(source, /legalAuthority\.artifactBindings/u);
});
