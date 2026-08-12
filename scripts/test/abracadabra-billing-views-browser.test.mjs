import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createReviewedBrowserCleanup,
  openReviewedBrowser,
  reviewedBrowserLaunchArguments
} from "../../server/hosted/test/reviewed-browser-support.mjs";

const PROJECT_ID = "30000000-0000-4000-8000-000000000001";
const RECEIPT_ID = "40000000-0000-4000-8000-000000000001";
const VIEWPORTS = Object.freeze([
  { width: 320, height: 720, mobile: true },
  { width: 390, height: 844, mobile: true },
  { width: 1440, height: 1000, mobile: false }
]);

const FIXTURES = {
  invoice: {
    schema: "sitesourcery.alakazam-invoice/v1",
    projectId: PROJECT_ID,
    receiptId: RECEIPT_ID,
    invoiceNumber: "SSAK-40000000000040008000000000000001",
    state: "settled",
    kind: "start_payment",
    tier: { tierId: "alakazam_25", name: "Alakazam 25" },
    issuedAt: "2026-08-08T12:00:00.000Z",
    settledAt: "2026-08-08T12:00:00.000Z",
    currency: "USD",
    lines: [
      {
        lineNumber: 1,
        description: "Alakazam first month",
        quantity: 1,
        unitAmountMinor: 2500,
        amountMinor: 2500
      }
    ],
    credits: [
      {
        kind: "download_purchase",
        description: "Download purchase credit",
        amountMinor: 500
      }
    ],
    totals: {
      subtotalMinor: 2500,
      discountMinor: 500,
      netSubtotalMinor: 2000,
      taxMinor: 0,
      taxState: "disabled_by_owner",
      totalMinor: 2000,
      currency: "USD"
    },
    settlement: {
      state: "settled",
      settledAt: "2026-08-08T12:00:00.000Z",
      providerInvoiceRecorded: true,
      settlementDigest: "a".repeat(64)
    },
    catalog: {
      catalogVersion: "alakazam.2026-08-02.v1",
      termsVersion:
        "alakazam-owner-contract.2026-08-02.v1"
    }
  },
  preview: {
    schema:
      "sitesourcery.alakazam-cancellation-preview/v1",
    projectId: PROJECT_ID,
    state: "available",
    accountState: "attention_required",
    subscription: {
      tierId: "alakazam_50",
      name: "Alakazam 50",
      status: "grace",
      amountMinor: 5000,
      currency: "USD",
      currentPeriodEndsAt: "2026-09-08T11:10:00.000Z"
    },
    effect: {
      endsAt: "2026-09-08T11:10:00.000Z",
      keepsAccessUntil: "2026-09-08T11:10:00.000Z",
      alreadyScheduled: false,
      website: {
        state: "live",
        hostname: "a-really-long-example-address.sitesourcery.me",
        url: "https://a-really-long-example-address.sitesourcery.me/",
        publishedUntil: "2026-09-08T11:10:00.000Z",
        afterEnd: "not_published"
      },
      renewalStopped: {
        tierId: "alakazam_50",
        amountMinor: 5000,
        currency: "USD",
        dueAt: "2026-09-08T11:10:00.000Z",
        chargedIfCancelled: false,
        currentTierId: "alakazam_50"
      },
      savedSetupKept: true,
      receiptsKept: true,
      refund: {
        state: "owner_review_required",
        cashRefundMinor: null,
        providerProration: null
      }
    },
    policy: {
      cancellationPolicy:
        "owner_review_required_before_release",
      released: false,
      releaseBlocker: "cancellation_policy"
    },
    actions: {
      confirmCancellation: {
        available: false,
        reason:
          "cancellation_policy_owner_review_required"
      },
      billingPortal: {
        available: false,
        state: "held",
        reason: "alakazam_billing_held"
      },
      reason: "cancellation_preview_only"
    }
  },
  states: {
    schema: "sitesourcery.alakazam-billing-states/v1",
    projectId: PROJECT_ID,
    observedAt: "2026-08-08T12:00:00.000Z",
    revision: 3,
    providerObservedAt: "2026-08-08T11:30:00.000Z",
    payment: {
      state: "retrying",
      subscriptionStatus: "grace",
      retry: {
        active: true,
        startedAt: "2026-08-08T11:30:00.000Z",
        graceEndsAt: "2026-08-22T11:30:00.000Z"
      }
    },
    replay: {
      state: "attention_required",
      outstanding: 2,
      failed: 1,
      processedThrough: "2026-08-08T11:12:05.000Z",
      lastEventAt: "2026-08-08T11:25:00.000Z",
      duplicateSuppressed: true,
      maximumAttempts: 6
    },
    reconciliation: {
      state: "required",
      kind: "downgrade_schedule",
      since: "2026-08-08T11:41:00.000Z"
    },
    display: { attentionRequired: true, settled: false }
  }
};

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Alakazam billing views</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 1rem;
    font: 16px/1.5 system-ui, sans-serif;
    max-width: 44rem;
  }
  section { margin-block-end: 2rem; }
  h2 { font-size: 1.25rem; margin-block: 0 0.25rem; }
  dl { display: grid; gap: 0.5rem 1rem; margin: 0; }
  dt { font-weight: 600; }
  dd { margin: 0; overflow-wrap: anywhere; }
  .row, .total {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    justify-content: space-between;
    padding-block: 0.4rem;
    border-block-end: 1px solid rgba(128,128,128,0.35);
  }
  .total { font-weight: 700; border-block-end: 0; }
  .reference { overflow-wrap: anywhere; font-family: ui-monospace, monospace; }
  .notice { padding: 0.75rem; border-radius: 0.5rem; background: rgba(128,128,128,0.15); margin-block-end: 0.5rem; }
  .notice p { margin: 0; }
  button[disabled] { min-height: 44px; width: 100%; max-width: 22rem; }
</style>
</head>
<body>
<main id="app"></main>
<script src="/abracadabra-billing-views.js"></script>
<script>
  var views = window.SiteSourceryAlakazamBillingViews;
  var fixtures = FIXTURES_JSON;
  var app = document.getElementById("app");

  function el(tag, className, textContent) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (textContent != null) node.textContent = textContent;
    return node;
  }

  function renderInvoice(shown) {
    var section = el("section");
    section.id = "invoice";
    section.appendChild(el("h2", null, shown.heading));
    section.appendChild(el("p", null, shown.summary));
    section.appendChild(el("p", "reference", shown.reference));
    shown.rows.forEach(function (row) {
      var line = el("div", "row");
      line.appendChild(el("span", null, row.label));
      line.appendChild(el("span", null, row.value));
      section.appendChild(line);
    });
    var total = el("div", "total");
    total.appendChild(el("span", null, shown.totalLabel));
    total.appendChild(el("span", null, shown.totalValue));
    section.appendChild(total);
    section.appendChild(el("p", null, shown.note));
    return section;
  }

  function renderPreview(shown) {
    var section = el("section");
    section.id = "cancellation";
    section.appendChild(el("h2", null, shown.heading));
    section.appendChild(el("p", null, shown.summary));
    var list = el("dl");
    shown.facts.forEach(function (fact) {
      list.appendChild(el("dt", null, fact.label));
      list.appendChild(el("dd", null, fact.value));
    });
    section.appendChild(list);
    section.appendChild(el("p", null, shown.policyNote));
    section.appendChild(el("p", null, shown.portalNote));
    var confirm = el("button", null, "Cancel this plan");
    confirm.type = "button";
    confirm.disabled = !shown.confirmAvailable;
    section.appendChild(confirm);
    return section;
  }

  function renderStates(shown) {
    var section = el("section");
    section.id = "states";
    section.appendChild(el("h2", null, shown.heading));
    shown.notices.forEach(function (notice) {
      var box = el("div", "notice");
      box.dataset.tone = notice.tone;
      box.appendChild(el("p", null, notice.title));
      box.appendChild(el("p", null, notice.detail));
      section.appendChild(box);
    });
    section.appendChild(el("p", null, shown.asOf));
    return section;
  }

  app.appendChild(renderStates(
    views.alakazamBillingStatesPresentation(
      fixtures.states, fixtures.projectId
    )
  ));
  app.appendChild(renderPreview(
    views.alakazamCancellationPreviewPresentation(
      fixtures.preview, fixtures.projectId
    )
  ));
  app.appendChild(renderInvoice(
    views.alakazamInvoicePresentation(
      fixtures.invoice, fixtures.projectId, fixtures.receiptId
    )
  ));
  document.documentElement.dataset.ready = "true";
</script>
</body>
</html>`;

test("the reviewed GitHub Linux browser launch stays bounded to the local fixture", () => {
  const argumentsList = reviewedBrowserLaunchArguments({
    origin: "http://127.0.0.1:4173",
    port: 9222,
    profile: "/tmp/sitesourcery-reviewed-browser-test",
    platform: "linux",
    githubActions: true
  });
  assert.ok(argumentsList.includes("--no-sandbox"));
  assert.ok(argumentsList.includes("--disable-background-networking"));
  assert.ok(argumentsList.includes("--remote-debugging-port=9222"));
  assert.ok(argumentsList.includes(
    "--unsafely-treat-insecure-origin-as-secure=http://127.0.0.1:4173"
  ));
  assert.equal(argumentsList.at(-1), "about:blank");
  assert.equal(
    reviewedBrowserLaunchArguments({
      origin: "http://127.0.0.1:4173",
      port: 9222,
      profile: "/tmp/sitesourcery-reviewed-browser-test",
      platform: "darwin",
      githubActions: true
    }).includes("--no-sandbox"),
    false
  );
  assert.equal(
    reviewedBrowserLaunchArguments({
      origin: "https://example.invalid",
      port: 9222,
      profile: "/tmp/sitesourcery-reviewed-browser-test",
      platform: "linux",
      githubActions: true
    }).includes("--no-sandbox"),
    false
  );
});

test("forced browser-exit timeout fails closed, cleans the profile, and remains retryable", async () => {
  const waits = [false, false, true];
  const signals = [];
  let exited = false;
  let connectionCloses = 0;
  let profileRemovals = 0;
  const cleanup = createReviewedBrowserCleanup({
    browserExited: () => exited,
    signalBrowser(signal) {
      signals.push(signal);
    },
    async waitForExit(milliseconds) {
      assert.equal(milliseconds, 2000);
      const result = waits.shift();
      if (result) exited = true;
      return result;
    },
    closeConnection() {
      connectionCloses += 1;
    },
    async removeProfile() {
      profileRemovals += 1;
    }
  });

  await assert.rejects(
    cleanup.close(),
    (error) => error?.code === "REVIEWED_BROWSER_EXIT_TIMEOUT"
  );
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(connectionCloses, 1);
  assert.equal(profileRemovals, 1);

  await cleanup.close();
  await cleanup.close();
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL", "SIGTERM"]);
  assert.equal(connectionCloses, 2);
  assert.equal(profileRemovals, 2);
  assert.deepEqual(waits, []);
});

async function serve() {
  const module = await readFile(
    new URL(
      "../../abracadabra/app/abracadabra-billing-views.js",
      import.meta.url
    ),
    "utf8"
  );
  const html = PAGE.replace(
    "FIXTURES_JSON",
    JSON.stringify({
      ...FIXTURES,
      projectId: PROJECT_ID,
      receiptId: RECEIPT_ID
    })
  );
  const server = createServer((request, response) => {
    if (
      request.url === "/abracadabra-billing-views.js"
    ) {
      response.writeHead(200, {
        "Content-Type": "text/javascript; charset=utf-8"
      });
      response.end(module);
      return;
    }
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8"
    });
    response.end(html);
  });
  await new Promise((resolve) =>
    server.listen(0, "127.0.0.1", resolve)
  );
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((resolve) =>
        server.close(resolve)
      );
    }
  };
}

for (const viewport of VIEWPORTS) {
  test(
    `the Alakazam billing views stay readable and free of horizontal overflow at ${viewport.width}x${viewport.height}`,
    async () => {
      const site = await serve();
      let browser = null;
      try {
        browser = await openReviewedBrowser({
          origin: site.origin,
          viewport
        });
        await browser.navigate(`${site.origin}/`);
        await browser.waitFor(
          'document.documentElement.dataset.ready === "true"'
        );
        const audit = await browser.evaluate(`(() => {
          const overflow =
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth;
          const wide = [...document.querySelectorAll("*")]
            .filter((node) =>
              node.getBoundingClientRect().right >
              document.documentElement.clientWidth + 1
            )
            .map((node) => node.tagName + "." + node.className);
          const sections = [...document.querySelectorAll("section")]
            .map((node) => ({
              id: node.id,
              height: Math.round(
                node.getBoundingClientRect().height
              )
            }));
          const button = document.querySelector("button");
          const buttonBox = button.getBoundingClientRect();
          return {
            overflow,
            wide,
            sections,
            text: document.body.innerText,
            buttonDisabled: button.disabled,
            buttonHeight: Math.round(buttonBox.height),
            buttonWidth: Math.round(buttonBox.width),
            noticeTones: [
              ...document.querySelectorAll(".notice")
            ].map((node) => node.dataset.tone)
          };
        })()`);

        assert.equal(
          audit.overflow,
          0,
          `horizontal overflow at ${viewport.width}px`
        );
        assert.deepEqual(
          audit.wide,
          [],
          `elements past the viewport at ${viewport.width}px`
        );
        assert.equal(audit.sections.length, 3);
        for (const section of audit.sections) {
          assert.ok(
            section.height > 0,
            `${section.id} rendered nothing`
          );
        }

        // E-09: the true retry, replay and reconciliation states are visible.
        assert.match(
          audit.text,
          /A payment did not go through\./u
        );
        assert.match(
          audit.text,
          /keep trying until August 22, 2026/u
        );
        assert.match(
          audit.text,
          /A payment update did not finish\./u
        );
        assert.match(
          audit.text,
          /checking a scheduled plan change/u
        );
        assert.deepEqual(audit.noticeTones, [
          "attention",
          "attention",
          "waiting"
        ]);

        // E-08: the preview shows the consequences and offers no confirmation.
        assert.match(
          audit.text,
          /What cancelling would do/u
        );
        assert.match(
          audit.text,
          /Your plan keeps working until\s+September 8, 2026/u
        );
        assert.match(
          audit.text,
          /Stays published until September 8, 2026, then comes down\./u
        );
        assert.match(audit.text, /refund terms/u);
        assert.equal(audit.buttonDisabled, true);
        assert.ok(
          audit.buttonHeight >= 44,
          `cancel control is only ${audit.buttonHeight}px tall`
        );
        assert.ok(
          audit.buttonWidth <= viewport.width,
          "cancel control is wider than the viewport"
        );

        // A-03: the invoice is readable money with a stable reference.
        assert.match(
          audit.text,
          /Alakazam payment receipt/u
        );
        assert.match(
          audit.text,
          /SSAK-40000000000040008000000000000001/u
        );
        assert.match(audit.text, /Total paid\s+\$20\.00/u);
        assert.match(audit.text, /-\$5\.00/u);

        // Nothing internal reaches the page.
        for (const forbidden of [
          "Stripe",
          "webhook",
          "reconciliation_required",
          "cus_",
          "sub_",
          "in_",
          "evt_"
        ]) {
          assert.equal(
            audit.text.includes(forbidden),
            false,
            `page leaked ${forbidden}`
          );
        }
        assert.deepEqual(browser.browserErrors, []);
      } finally {
        try {
          if (browser) await browser.close();
        } finally {
          await site.close();
        }
      }
    }
  );
}
