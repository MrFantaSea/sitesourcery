import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

import { openReviewedBrowser } from
  "../../hosted/test/reviewed-browser-support.mjs";

const CUSTOMER_CONTROL = new URL(
  "../../../abracadabra/app/abracadabra-customer-control-dom.js",
  import.meta.url
);

function page(fixtures) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Assessment and Custom artifact contracts</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font: 16px/1.5 system-ui, sans-serif; }
    main { max-width: 48rem; margin: auto; padding: 1rem; }
    li, code { overflow-wrap: anywhere; }
  </style>
</head>
<body>
<main>
  <h1>Assessment and Custom artifact contracts</h1>
  <dl>
    <dt>Assessment report</dt><dd id="report-state"></dd>
    <dt>Custom final state</dt><dd id="final-state"></dd>
    <dt>Handoff summary</dt><dd id="handoff"></dd>
  </dl>
</main>
<script src="/customer-control.js"></script>
<script>
  (function () {
    var fixtures = ${JSON.stringify(fixtures)};
    var api = window.SiteSourceryAbracadabraCustomerControl;
    var report = api.verifiedCustomerAssessmentReport(
      fixtures.assessmentReport,
      fixtures.projectId
    );
    var finalState = api.verifiedCustomerCustomBuildFinalState(
      fixtures.finalState,
      fixtures.projectId
    );
    var handoff = api.verifiedCustomerCustomBuildHandoffDocument(
      fixtures.handoffDocument,
      finalState
    );
    if (!report || !finalState || !handoff) {
      throw new Error("Retained browser contracts rejected the artifacts");
    }
    document.getElementById("report-state").textContent = report.state;
    document.getElementById("final-state").textContent = finalState.state;
    document.getElementById("handoff").textContent =
      handoff.payload.customerSummary;
    window.assessmentCustomArtifacts = {
      reportState: report.state,
      finalState: finalState.state,
      handoffDigest: handoff.contentDigest,
      renderedArtifacts: 3
    };
    document.documentElement.dataset.ready = "true";
  }());
</script>
</body>
</html>`;
}

async function serve(fixtures) {
  const control = await readFile(CUSTOMER_CONTROL);
  const html = page(fixtures);
  const server = createServer((request, response) => {
    if (request.url === "/customer-control.js") {
      response.writeHead(200, {
        "Content-Type": "text/javascript; charset=utf-8"
      });
      response.end(control);
      return;
    }
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8"
    });
    response.end(html);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    })
  };
}

export async function proveAssessmentCustomArtifactContractRender(fixtures) {
  const site = await serve(fixtures);
  let browser = null;
  let primaryFailure = null;
  let proof = null;
  try {
    browser = await openReviewedBrowser({
      origin: site.origin,
      viewport: { width: 390, height: 844, mobile: true }
    });
    await browser.navigate(`${site.origin}/`);
    await browser.waitFor(
      'document.documentElement.dataset.ready === "true"'
    );
    const rendered = await browser.evaluate(`(() => ({
      proof: window.assessmentCustomArtifacts,
      overflow: document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
      reportText: document.getElementById("report-state").textContent,
      finalText: document.getElementById("final-state").textContent,
      handoffText: document.getElementById("handoff").textContent
    }))()`);
    assert.equal(rendered.overflow, 0);
    assert.equal(rendered.proof.reportState, "delivered");
    assert.equal(rendered.proof.finalState, "handed_off");
    assert.equal(
      rendered.proof.handoffDigest,
      fixtures.handoffDocument.contentDigest
    );
    assert.equal(rendered.proof.renderedArtifacts, 3);
    assert.equal(rendered.reportText, "delivered");
    assert.equal(rendered.finalText, "handed_off");
    assert.equal(
      rendered.handoffText,
      fixtures.handoffDocument.payload.customerSummary
    );
    assert.deepEqual(browser.browserErrors, []);
    proof = Object.freeze({
      browser: "Google Chrome for Testing 149.0.7827.55",
      renderedArtifacts: 3,
      viewport: "390x844"
    });
  } catch (error) {
    primaryFailure = error;
  }
  const cleanup = await Promise.allSettled([
    browser ? browser.close() : Promise.resolve(),
    site.close()
  ]);
  const failures = [
    ...(primaryFailure === null ? [] : [primaryFailure]),
    ...cleanup
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason)
  ];
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      "Assessment/Custom artifact browser proof or cleanup failed"
    );
  }
  return proof;
}
