import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const require = createRequire(import.meta.url);
const makerModule = require("../../abracadabra/app/abracadabra-app.js");
const viewerModule = require("../../abracadabra/site/viewer.js");
const makerPath = path.join(
  projectRoot,
  "abracadabra/app/abracadabra-app.js"
);
const viewerPath = path.join(projectRoot, "abracadabra/site/viewer.js");
const hivePath = path.join(projectRoot, "hive/hive-planner.js");
const [makerSource, viewerSource, hiveSource] = await Promise.all([
  readFile(makerPath, "utf8"),
  readFile(viewerPath, "utf8"),
  readFile(hivePath, "utf8"),
]);

function loadHivePlanner() {
  const context = vm.createContext({});
  new vm.Script(hiveSource, { filename: hivePath }).runInContext(context);
  return context.SiteSourceryHivePlanner;
}

function deliveryHarness(initialFailure = "") {
  let failure = initialFailure;
  const trace = {
    appendAttempts: 0,
    blobs: [],
    clickAttempts: 0,
    clicked: 0,
    createUrlAttempts: 0,
    links: [],
    openAttempts: 0,
    openedWindows: [],
    removed: 0,
    revoked: [],
    timers: [],
  };

  class FakeBlob {
    constructor(parts, options) {
      if (failure === "blob") throw new Error("Blob failed");
      this.parts = parts;
      this.type = options && options.type;
      trace.blobs.push(this);
    }
  }

  const body = {
    appendChild(link) {
      trace.appendAttempts += 1;
      if (failure === "append") throw new Error("append failed");
      link.parentNode = body;
      return link;
    },
    removeChild(link) {
      trace.removed += 1;
      link.parentNode = null;
    },
  };

  const environment = {
    Blob: FakeBlob,
    URL: {
      createObjectURL() {
        trace.createUrlAttempts += 1;
        if (failure === "url") throw new Error("URL failed");
        return `blob:local-${trace.createUrlAttempts}`;
      },
      revokeObjectURL(value) {
        trace.revoked.push(value);
      },
    },
    document: {
      body,
      createElement(tagName) {
        assert.equal(tagName, "a");
        const link = {
          click() {
            trace.clickAttempts += 1;
            if (failure === "click") throw new Error("click failed");
            trace.clicked += 1;
          },
          hidden: false,
          parentNode: null,
          remove() {
            trace.removed += 1;
            this.parentNode = null;
          },
        };
        trace.links.push(link);
        return link;
      },
    },
    open(url, target) {
      trace.openAttempts += 1;
      if (failure === "open") throw new Error("open failed");
      if (failure === "popup") return null;
      const openedWindow = { opener: environment, target, url };
      trace.openedWindows.push(openedWindow);
      return openedWindow;
    },
    setTimeout(callback, delay) {
      trace.timers.push(delay);
      callback();
      return trace.timers.length;
    },
  };

  return {
    environment,
    failAt(value) {
      failure = value;
    },
    trace,
  };
}

const makerOpenFailure = "The working page could not open. Nothing was changed. Select Open again to retry.";
const viewerFailure = "The download could not start. Nothing was downloaded. Select Download again to retry.";
const hiveFailure = "The plan download could not start. Nothing was downloaded. Select Download again to retry.";

const providers = [
  {
    failure: viewerFailure,
    invoke(environment, button, status) {
      return viewerModule.deliverLocalFile(environment, {
        button,
        failureMessage: viewerFailure,
        filename: "saved-website.html",
        parts: ["<!doctype html><title>Saved</title>"],
        revokeDelay: 1000,
        status,
        successMessage: "Download started. Check your Downloads folder.",
        type: "text/html;charset=utf-8",
      });
    },
    name: "local viewer export",
    success: "Download started. Check your Downloads folder.",
  },
  {
    failure: hiveFailure,
    invoke(environment, button, status) {
      return loadHivePlanner().downloadBlueprint("booking", environment, {
        button,
        status,
      });
    },
    name: "Hive JSON download",
    success: "Plan download started. No workflow was activated.",
  },
];

for (const provider of providers) {
  test(`${provider.name} revokes its URL, removes its link, and reports success after click`, () => {
    const harness = deliveryHarness();
    const button = { disabled: false };
    const status = { textContent: "" };

    assert.equal(provider.invoke(harness.environment, button, status), true);
    assert.equal(button.disabled, false);
    assert.equal(status.textContent, provider.success);
    assert.equal(harness.trace.clicked, 1);
    assert.equal(harness.trace.removed, 1);
    assert.deepEqual(harness.trace.revoked, ["blob:local-1"]);
    assert.equal(harness.trace.links[0].hidden, true);
  });

  for (const failure of ["blob", "url", "append", "click"]) {
    test(`${provider.name} fails safely at ${failure} and remains retryable`, () => {
      const harness = deliveryHarness(failure);
      const button = { disabled: false };
      const status = { textContent: "" };

      assert.doesNotThrow(() => {
        assert.equal(provider.invoke(harness.environment, button, status), false);
      });
      assert.equal(button.disabled, false);
      assert.equal(status.textContent, provider.failure);
      assert.match(status.textContent, /retry/u);
      assert.notEqual(status.textContent, provider.success);

      if (failure === "append" || failure === "click") {
        assert.deepEqual(harness.trace.revoked, ["blob:local-1"]);
      } else {
        assert.deepEqual(harness.trace.revoked, []);
      }
      if (failure === "click") {
        assert.equal(harness.trace.removed, 1);
      }

      harness.failAt("");
      assert.equal(provider.invoke(harness.environment, button, status), true);
      assert.equal(button.disabled, false);
      assert.equal(status.textContent, provider.success);
      assert.equal(harness.trace.clicked, 1);
      assert.equal(
        harness.trace.revoked.length,
        failure === "append" || failure === "click" ? 2 : 1
      );
    });
  }
}

test("maker preview reports success only after the browser returns an opened window", () => {
  const harness = deliveryHarness();
  const button = { disabled: false };
  const status = { textContent: "" };

  assert.equal(
    makerModule.openLocalPreview(harness.environment, {
      button,
      failureMessage: makerOpenFailure,
      parts: ["<!doctype html><title>Maker</title>"],
      revokeDelay: 60_000,
      status,
      successMessage: "Working page opened in a new tab.",
      type: "text/html;charset=utf-8",
    }),
    true
  );
  assert.equal(button.disabled, false);
  assert.equal(status.textContent, "Working page opened in a new tab.");
  assert.equal(harness.trace.openAttempts, 1);
  assert.equal(harness.trace.openedWindows[0].target, "_blank");
  assert.equal(harness.trace.openedWindows[0].url, "blob:local-1");
  assert.equal(harness.trace.openedWindows[0].opener, null);
  assert.equal(harness.trace.links.length, 0);
  assert.deepEqual(harness.trace.timers, [60_000]);
  assert.deepEqual(harness.trace.revoked, ["blob:local-1"]);
});

for (const failure of ["blob", "url", "open", "popup"]) {
  test(`maker preview fails truthfully at ${failure} and remains retryable`, () => {
    const harness = deliveryHarness(failure);
    const button = { disabled: false };
    const status = { textContent: "" };
    const invoke = () => makerModule.openLocalPreview(harness.environment, {
      button,
      failureMessage: makerOpenFailure,
      parts: ["<!doctype html><title>Maker</title>"],
      revokeDelay: 60_000,
      status,
      successMessage: "Working page opened in a new tab.",
      type: "text/html;charset=utf-8",
    });

    assert.doesNotThrow(() => assert.equal(invoke(), false));
    assert.equal(button.disabled, false);
    assert.equal(status.textContent, makerOpenFailure);
    assert.notEqual(status.textContent, "Working page opened in a new tab.");
    assert.deepEqual(
      harness.trace.revoked,
      failure === "open" || failure === "popup" ? ["blob:local-1"] : []
    );

    harness.failAt("");
    assert.equal(invoke(), true);
    assert.equal(status.textContent, "Working page opened in a new tab.");
    assert.equal(harness.trace.openedWindows.length, 1);
  });
}

test("Hive download contains the selected deterministic JSON blueprint", () => {
  const harness = deliveryHarness();

  assert.equal(
    providers[1].invoke(
      harness.environment,
      { disabled: false },
      { textContent: "" }
    ),
    true
  );
  const payload = JSON.parse(harness.trace.blobs[0].parts.join(""));
  assert.equal(payload.schema, "sitesourcery.hive-blueprint.v1");
  assert.equal(payload.cell.id, "booking");
  assert.equal(payload.liveIntegration, false);
  assert.equal(
    harness.trace.links[0].download,
    "hive-booking-blueprint.json"
  );
});

test("free Abracadabra preview has no direct Download handler while paid/local exports stay guarded", () => {
  assert.doesNotMatch(makerSource, /function downloadCurrent\(|downloadButton\.addEventListener/u);
  assert.match(
    makerSource,
    /function openCurrentPreview\(\)[\s\S]*?openLocalPreview\(window,[\s\S]*?function loadFictionalSample\(\)/u
  );
  assert.match(
    viewerSource,
    /function downloadExport\(record, button\)[\s\S]*?return deliverLocalFile\(window,[\s\S]*?function showResolutionFailure\(\)/u
  );
  assert.match(
    hiveSource,
    /fields\.download\.addEventListener\("click", function \(\) \{[\s\S]*?downloadBlueprint\(cellId, global,/u
  );
});
