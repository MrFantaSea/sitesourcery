import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("production root composes canonical queue, reconciliation, and support lifecycle", async () => {
  const source = await readFile(new URL("../bin/server.mjs", import.meta.url), "utf8");
  assert.match(source, /createPostgresSupportCaseRepository/u);
  assert.match(source, /createSupportCaseService/u);
  assert.match(
    source,
    /const supportCases = createSupportCaseService\(\{\s*repository: createPostgresSupportCaseRepository\(\{ authority \}\),\s*mailLifecycle,\s*clock: commerceV2[.]clock\s*\}\)/u
  );
  assert.match(source, /const supportCaseReadiness = await supportCases[.]readiness\(\)/u);
  assert.match(source, /if \(supportCaseReadiness[.]ready !== true\)/u);
  assert.match(
    source,
    /operatorWorkQueue: professionalLifecycle[.]operatorQueue,\s*operatorProviderReconciliation,\s*supportCases,/u
  );
  assert.match(source, /createPostgresProviderReconciliationOperator/u);
  assert.match(
    source,
    /operatorProviderReconciliationReadiness[.]providerEffects !== false/u
  );
  assert.doesNotMatch(
    source,
    /supportCases[\s\S]{0,120}(?:\bproviderPort\b|\bsendMail\b|\bdeletionExecution\b|\bexportExecution\b)/u
  );
});
