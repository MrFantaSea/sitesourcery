import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  mkdir,
  readFile,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  openReviewedBrowser
} from "../../server/hosted/test/reviewed-browser-support.mjs";

const ROOT = path.resolve(
  new URL("../..", import.meta.url).pathname
);
const SCREENSHOT_DIRECTORY = path.join(
  ROOT,
  "proof/customer-ux-b"
);
const VIEWPORTS = Object.freeze([
  { width: 320, height: 720, mobile: true },
  { width: 390, height: 844, mobile: true },
  { width: 1440, height: 1000, mobile: false }
]);

const PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Customer UX 01B proof</title>
  <link rel="stylesheet" href="/vnext.css">
  <link rel="stylesheet" href="/abracadabra-app.css">
</head>
<body class="vnext-page abracadabra-app-page">
  <main id="main" class="site-shell"></main>
  <script src="/customer-control.js"></script>
  <script>
    (function () {
      var api = window.SiteSourceryAbracadabraCustomerControl;
      var actions = [];
      var state = {
        account: { id: "10000000-0000-4000-8000-000000000001" },
        project: {
          id: "30000000-0000-4000-8000-000000000001",
          name: "Customer project"
        },
        exportJob: null,
        operations: {},
        online: true,
        syncing: false,
        sessionEnded: false,
        checkoutNotice: api.customerCheckoutExperiencePresentation(
          "cancelled",
          "download"
        )
      };
      var panel;
      function render() {
        panel.render(state);
      }
      panel = api.createCustomerAccountRoutesPanel(document, {
        refresh: function () {
          actions.push({ action: "refresh" });
          state.syncing = true;
          render();
          state.syncing = false;
          render();
          return Promise.resolve(state);
        },
        support: function (input) {
          actions.push({ action: "support", input: input });
          return Promise.resolve({ supportTicket: { state: "open" } });
        },
        requestExport: function () {
          actions.push({ action: "requestExport" });
          state.exportJob = {
            exportId: "40000000-0000-4000-8000-000000000001",
            projectId: state.project.id,
            status: "queued",
            createdAt: "2026-08-10T16:00:00.000Z",
            updatedAt: "2026-08-10T16:00:00.000Z"
          };
          render();
          return Promise.resolve(state.exportJob);
        },
        refreshExport: function () {
          actions.push({ action: "refreshExport" });
          state.exportJob = Object.assign({}, state.exportJob, {
            status: "ready",
            filename: "sitesourcery-project-export.zip",
            updatedAt: "2026-08-10T16:01:00.000Z",
            download: {
              expiresAt: "2026-08-10T16:16:00.000Z"
            }
          });
          render();
          return Promise.resolve(state.exportJob);
        },
        downloadExport: function () {
          actions.push({ action: "downloadExport" });
          return Promise.resolve({ filename: state.exportJob.filename });
        },
        retryExport: function () {
          actions.push({ action: "retryExport" });
          return Promise.resolve(state.exportJob);
        }
      });
      document.getElementById("main").appendChild(panel.element);
      render();
      window.customerUxProof = {
        actions: actions,
        renderCheckout: function (checkoutState) {
          state.checkoutNotice =
            api.customerCheckoutExperiencePresentation(
              checkoutState,
              checkoutState === "declined"
                ? "custom_build_change"
                : checkoutState === "no_charge"
                  ? "custom_build_final"
                  : "download"
            );
          render();
        },
        renderConnection: function (mode) {
          state.online = mode !== "offline";
          state.sessionEnded = mode === "session-ended";
          state.account = state.sessionEnded ? null : {
            id: "10000000-0000-4000-8000-000000000001"
          };
          state.project = state.sessionEnded ? null : {
            id: "30000000-0000-4000-8000-000000000001",
            name: "Customer project"
          };
          render();
        }
      };
      document.documentElement.dataset.ready = "true";
    }());
  </script>
</body>
</html>`;

async function serve() {
  const [control, appCss, baseCss] = await Promise.all([
    readFile(path.join(
      ROOT,
      "abracadabra/app/abracadabra-customer-control-dom.js"
    )),
    readFile(path.join(
      ROOT,
      "abracadabra/app/abracadabra-app.css"
    )),
    readFile(path.join(ROOT, "vnext.css"))
  ]);
  const server = createServer((request, response) => {
    if (request.url === "/customer-control.js") {
      response.writeHead(200, {
        "Content-Type": "text/javascript; charset=utf-8"
      });
      response.end(control);
      return;
    }
    if (request.url === "/abracadabra-app.css") {
      response.writeHead(200, {
        "Content-Type": "text/css; charset=utf-8"
      });
      response.end(appCss);
      return;
    }
    if (request.url === "/vnext.css") {
      response.writeHead(200, {
        "Content-Type": "text/css; charset=utf-8"
      });
      response.end(baseCss);
      return;
    }
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8"
    });
    response.end(PAGE);
  });
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

for (const viewport of VIEWPORTS) {
  test(
    `CUSTOMER-UX-01B stays operable at ${viewport.width}x${viewport.height}`,
    async () => {
      const site = await serve();
      const browser = await openReviewedBrowser({
        origin: site.origin,
        viewport
      });
      try {
        await browser.navigate(`${site.origin}/`);
        await browser.waitFor(
          'document.documentElement.dataset.ready === "true"'
        );

        await browser.evaluate(`(() => {
          document.querySelector('[name="customerSupportSubject"]')
            .value = "Project help";
          document.querySelector('[name="customerSupportMessage"]')
            .value = "Please help with the selected project.";
          document.querySelector('[data-customer-create-support-ticket]')
            .click();
        })()`);
        await browser.waitFor(
          "customerUxProof.actions.some((entry) => entry.action === 'support')"
        );
        await browser.evaluate(
          "document.querySelector('[data-customer-request-export]').click()"
        );
        await browser.waitFor(
          "document.querySelector('[data-customer-export-status]').textContent.includes('queued')"
        );
        await browser.evaluate(
          "document.querySelector('[data-customer-refresh-export]').click()"
        );
        await browser.waitFor(
          "document.querySelector('[data-customer-export-status]').textContent.includes('Export ready')"
        );
        await browser.evaluate(
          "document.querySelector('[data-customer-download-export]').click()"
        );
        await browser.waitFor(
          "customerUxProof.actions.some((entry) => entry.action === 'downloadExport')"
        );

        const checkoutStates = await browser.evaluate(`(() => {
          const shown = {};
          for (const state of [
            "cancelled",
            "declined",
            "abandoned",
            "no_charge"
          ]) {
            customerUxProof.renderCheckout(state);
            const node = document.querySelector('[data-customer-checkout-state]');
            shown[state] = {
              marker: node.getAttribute('data-customer-checkout-state'),
              text: node.innerText
            };
          }
          return shown;
        })()`);
        assert.equal(checkoutStates.cancelled.marker, "cancelled");
        assert.match(
          checkoutStates.cancelled.text,
          /did not confirm a payment/u
        );
        assert.match(
          checkoutStates.declined.text,
          /original approved scope remains/u
        );
        assert.match(
          checkoutStates.abandoned.text,
          /fresh status check/u
        );
        assert.match(
          checkoutStates.no_charge.text,
          /zero balance/u
        );

        const recoveryStates = await browser.evaluate(`(() => {
          customerUxProof.renderConnection("offline");
          const offline = {
            text: document.querySelector('.customer-account-route-status').textContent,
            supportDisabled: document.querySelector('[data-customer-create-support-ticket]').disabled,
            exportDisabled: document.querySelector('[data-customer-download-export]').disabled
          };
          customerUxProof.renderConnection("session-ended");
          const expired = {
            text: document.querySelector('.customer-account-route-status').textContent,
            supportDisabled: document.querySelector('[data-customer-create-support-ticket]').disabled
          };
          customerUxProof.renderConnection("ready");
          document.querySelector('[data-customer-refresh-account]').click();
          customerUxProof.renderCheckout("cancelled");
          return { offline, expired };
        })()`);
        assert.match(recoveryStates.offline.text, /Offline/u);
        assert.equal(recoveryStates.offline.supportDisabled, true);
        assert.equal(recoveryStates.offline.exportDisabled, true);
        assert.match(
          recoveryStates.expired.text,
          /session ended or changed/u
        );
        assert.equal(recoveryStates.expired.supportDisabled, true);
        await browser.waitFor(
          "customerUxProof.actions.some((entry) => entry.action === 'refresh')"
        );

        const audit = await browser.evaluate(`(() => {
          const root = document.documentElement;
          const visibleTargets = [...document.querySelectorAll(
            '.customer-account-routes button, .customer-account-routes a, .customer-account-routes input, .customer-account-routes textarea'
          )].filter((node) => node.getClientRects().length > 0);
          return {
            overflow: root.scrollWidth - root.clientWidth,
            wide: [...document.querySelectorAll('*')]
              .filter((node) => node.getClientRects().length > 0)
              .filter((node) =>
                node.getBoundingClientRect().right > root.clientWidth + 1
              )
              .map((node) => node.tagName + '.' + node.className),
            targetHeights: visibleTargets.map((node) => ({
              label: node.textContent || node.name || node.tagName,
              height: Math.round(node.getBoundingClientRect().height)
            })),
            accountDeleteHref: document.querySelector(
              '[data-customer-account-delete-route="manual"]'
            ).getAttribute('href'),
            privacyHref: document.querySelector(
              '[data-customer-privacy-request-route="manual"]'
            ).getAttribute('href'),
            supportCleared:
              document.querySelector('[name="customerSupportSubject"]').value === ''
              && document.querySelector('[name="customerSupportMessage"]').value === '',
            text: document.body.innerText,
            actions: customerUxProof.actions
          };
        })()`);
        assert.equal(audit.overflow, 0);
        assert.deepEqual(audit.wide, []);
        assert.equal(audit.accountDeleteHref, "/legal/privacy/#contact");
        assert.equal(audit.privacyHref, "/legal/privacy/#contact");
        assert.equal(audit.supportCleared, true);
        assert.match(audit.text, /another tab or device/u);
        assert.match(audit.text, /existing reviewed manual contact/u);
        assert.ok(
          audit.actions.some((entry) => entry.action === "requestExport")
        );
        assert.ok(
          audit.actions.some((entry) => entry.action === "refreshExport")
        );
        for (const target of audit.targetHeights) {
          assert.ok(
            target.height >= 44,
            `${target.label} is only ${target.height}px high at ${viewport.width}px`
          );
        }
        assert.deepEqual(browser.browserErrors, []);

        await mkdir(SCREENSHOT_DIRECTORY, { recursive: true });
        const screenshot = await browser.cdp.send(
          "Page.captureScreenshot",
          { format: "png", captureBeyondViewport: false }
        );
        await writeFile(
          path.join(
            SCREENSHOT_DIRECTORY,
            `customer-ux-b-${viewport.width}x${viewport.height}.png`
          ),
          Buffer.from(screenshot.data, "base64")
        );
      } finally {
        await browser.close();
        await site.close();
      }
    }
  );
}
