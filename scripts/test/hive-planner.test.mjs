import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const PROJECT_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../.."
);
const SOURCE_PATH = path.join(PROJECT_ROOT, "hive/hive-planner.js");
const SOURCE = await readFile(SOURCE_PATH, "utf8");
const HTML_PATH = path.join(PROJECT_ROOT, "hive/index.html");
const HTML = await readFile(HTML_PATH, "utf8");
const CSS_PATH = path.join(PROJECT_ROOT, "vnext.css");
const CSS = await readFile(CSS_PATH, "utf8");

const EXPECTED_CELL_IDS = [
  "missed-call",
  "booking",
  "review-request",
  "after-hours",
  "follow-up",
  "getting-paid",
];

function loadPlanner(extraGlobals = {}) {
  const context = vm.createContext(extraGlobals);
  new vm.Script(SOURCE, { filename: SOURCE_PATH }).runInContext(context);
  return context.SiteSourceryHivePlanner;
}

class FakeElement {
  constructor(attributes = {}) {
    this.attributes = new Map(
      Object.entries(attributes).map(([name, value]) => [name, String(value)])
    );
    this.controls = [];
    this.stages = [];
    this.indicators = [];
    this.nextButtons = [];
    this.output = null;
    this.queries = new Map();
    this.listeners = new Map();
    this.textContent = "";
    this.disabled = false;
    this.hidden = false;
    this.inert = false;
    this.focused = false;
  }

  matches(selector) {
    return selector === "[data-hive-planner]" &&
      this.attributes.has("data-hive-planner");
  }

  querySelectorAll(selector) {
    if (selector === "[data-hive-cell]") return this.controls;
    if (selector === "[data-hive-stage]") return this.stages;
    if (selector === "[data-hive-step-indicator]") return this.indicators;
    if (selector === "[data-hive-next]") return this.nextButtons;
    if (selector === "[data-hive-planner]") {
      return this.matches(selector) ? [this] : [];
    }
    return [];
  }

  querySelector(selector) {
    if (selector === "[data-hive-output]") return this.output;
    return this.queries.get(selector) || null;
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  dispatch(type) {
    let prevented = false;
    const event = {
      preventDefault() {
        prevented = true;
      },
    };
    for (const listener of this.listeners.get(type) || []) listener(event);
    return prevented;
  }

  click() {
    return this.dispatch("click");
  }

  focus() {
    this.focused = true;
  }
}

function buildPlannerFixture({ hash = "" } = {}) {
  const root = new FakeElement({ "data-hive-planner": "" });
  const output = new FakeElement({ "data-hive-output": "" });
  const controls = EXPECTED_CELL_IDS.map(
    (cellId) => new FakeElement({ "data-hive-cell": cellId })
  );
  const invalidControl = new FakeElement({ "data-hive-cell": "__proto__" });
  const stages = Array.from({ length: 5 }, (_, index) =>
    new FakeElement({ "data-hive-stage": index + 1 })
  );
  const stageHeadings = stages.map((stage, index) => {
    if (index === 0) return null;
    const heading = new FakeElement({ "data-hive-stage-heading": "" });
    stage.queries.set("[data-hive-stage-heading]", heading);
    return heading;
  });
  const indicators = Array.from({ length: 5 }, (_, index) =>
    new FakeElement({ "data-hive-step-indicator": index + 1 })
  );
  const nextButtons = [3, 4, 5].map(
    (target) => new FakeElement({ "data-hive-next": target })
  );
  const fields = {
    start: new FakeElement({ "data-hive-start": "" }),
    status: new FakeElement({ "data-hive-status": "" }),
    live: new FakeElement({
      "data-hive-live": "",
      role: "status",
      "aria-live": "polite",
      "aria-atomic": "true",
    }),
    title: new FakeElement({ "data-hive-title": "" }),
    result: new FakeElement({ "data-hive-result": "" }),
    when: new FakeElement({ "data-hive-when": "" }),
    human: new FakeElement({ "data-hive-human": "" }),
    permission: new FakeElement({ "data-hive-permission": "" }),
    limit: new FakeElement({ "data-hive-limit": "" }),
    pauseCopy: new FakeElement({ "data-hive-pause-copy": "" }),
    pause: new FakeElement({ "data-hive-pause": "" }),
    pauseStatus: new FakeElement({ "data-hive-pause-status": "" }),
    download: new FakeElement({ "data-hive-download": "" }),
    downloadStatus: new FakeElement({ "data-hive-download-status": "" }),
    reviewLabel: new FakeElement({ "data-hive-review-label": "" }),
    reviewResult: new FakeElement({ "data-hive-review-result": "" }),
    reviewWhen: new FakeElement({ "data-hive-review-when": "" }),
    reviewHuman: new FakeElement({ "data-hive-review-human": "" }),
    reviewLimit: new FakeElement({ "data-hive-review-limit": "" }),
  };
  root.controls = [...controls, invalidControl];
  root.stages = stages;
  root.indicators = indicators;
  root.nextButtons = nextButtons;
  root.output = output;
  for (const [name, field] of Object.entries(fields)) {
    const attribute = name.replace(/[A-Z]/gu, (letter) =>
      `-${letter.toLowerCase()}`);
    root.queries.set(`[data-hive-${attribute}]`, field);
  }

  const location = { hash, pathname: "/hive/", search: "" };
  const historyUrls = [];
  const windowListeners = new Map();
  const history = {
    replaceState(_state, _title, url) {
      historyUrls.push(url);
      location.hash = url.includes("#") ? `#${url.split("#")[1]}` : "";
    },
  };
  const globalValues = {
    addEventListener(type, listener) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(listener);
    },
    history,
    location,
  };
  const planner = loadPlanner(globalValues);

  return {
    controls,
    fields,
    globalValues,
    historyUrls,
    indicators,
    invalidControl,
    nextButtons,
    output,
    planner,
    root,
    stageHeadings,
    stages,
    windowListeners,
  };
}

test("exports exactly six frozen deterministic Hive cell definitions", () => {
  const planner = loadPlanner();

  assert.equal(planner.schema, "sitesourcery.hive-blueprint.v1");
  assert.equal(planner.status, "planning_only");
  assert.deepEqual(
    Array.from(planner.cells, (cell) => cell.id),
    EXPECTED_CELL_IDS
  );
  assert.equal(Object.isFrozen(planner), true);
  assert.equal(Object.isFrozen(planner.cells), true);

  for (const cell of planner.cells) {
    assert.equal(Object.isFrozen(cell), true);
    assert.equal(Object.isFrozen(cell.customer), true);
    assert.equal(typeof cell.label, "string");
    assert.ok(cell.label.length > 0);
    assert.deepEqual(
      Object.keys(cell.customer).sort(),
      ["human", "limit", "pause", "permission", "result", "when"]
    );
    assert.equal(
      Object.values(cell.customer).every(
        (value) => typeof value === "string" && value.length > 20
      ),
      true
    );
    assert.equal(Reflect.set(cell, "label", "changed"), false);
  }
});

test("creates complete planning-only blueprints without live authority", () => {
  const planner = loadPlanner();
  const requiredStrings = [
    "problem",
    "trigger",
    "hardBoundary",
    "dataConsentConcern",
    "fallbackHumanHandoff",
    "killSwitch",
  ];

  for (const cellId of EXPECTED_CELL_IDS) {
    const blueprint = planner.createBlueprint(cellId);

    assert.equal(blueprint.schema, "sitesourcery.hive-blueprint.v1");
    assert.equal(blueprint.status, "planning_only");
    assert.equal(blueprint.liveIntegration, false);
    assert.match(blueprint.notice, /Planning blueprint only/);
    assert.equal(blueprint.cell.id, cellId);
    assert.ok(Object.isFrozen(blueprint));
    assert.ok(Object.isFrozen(blueprint.cell));
    assert.ok(Object.isFrozen(blueprint.allowedActions));
    assert.ok(blueprint.allowedActions.length >= 3);

    for (const field of requiredStrings) {
      assert.equal(typeof blueprint[field], "string");
      assert.ok(blueprint[field].length > 20, `${cellId}.${field}`);
    }
    for (const action of blueprint.allowedActions) {
      assert.equal(typeof action, "string");
      assert.ok(action.length > 20);
    }
  }
});

test("exports stable newline-terminated JSON and rejects unknown cells", () => {
  const planner = loadPlanner();

  for (const cellId of EXPECTED_CELL_IDS) {
    const first = planner.exportBlueprint(cellId);
    const second = planner.exportBlueprint(cellId);
    assert.equal(first, second);
    assert.ok(first.endsWith("\n"));
    assert.deepEqual(
      JSON.parse(first),
      JSON.parse(JSON.stringify(planner.createBlueprint(cellId)))
    );
  }

  for (const cellId of [
    "",
    "unknown",
    "__proto__",
    "prototype",
    "constructor",
    null,
    1,
  ]) {
    assert.throws(
      () => planner.createBlueprint(cellId),
      /Unknown Hive cell/
    );
    assert.throws(
      () => planner.exportBlueprint(cellId),
      /Unknown Hive cell/
    );
  }
});

test("starts with one choice and keeps every later stage hidden and inert", () => {
  const fixture = buildPlannerFixture();
  const {
    controls,
    fields,
    indicators,
    invalidControl,
    nextButtons,
    output,
    planner,
    root,
    stages,
  } = fixture;

  assert.equal(planner.enhance(root), 1);
  assert.equal(root.getAttribute("data-hive-planner-ready"), "true");
  assert.equal(root.getAttribute("data-hive-stage-current"), "1");
  assert.equal(root.hasAttribute("data-hive-active"), false);
  assert.equal(output.hasAttribute("aria-live"), false);
  assert.equal(fields.live.getAttribute("role"), "status");
  assert.equal(fields.live.getAttribute("aria-live"), "polite");
  assert.equal(fields.live.getAttribute("aria-atomic"), "true");
  assert.equal(fields.live.textContent, "Choose one business problem to begin.");
  assert.equal(fields.start.hidden, false);
  assert.equal(stages[0].hidden, false);
  assert.equal(
    stages.slice(1).every((stage) =>
      stage.hidden &&
      stage.inert &&
      stage.getAttribute("aria-hidden") === "true"),
    true
  );
  assert.equal(controls.every((control) => control.disabled === false), true);
  assert.equal(nextButtons.every((button) => button.disabled), true);
  assert.equal(fields.pause.disabled, true);
  assert.equal(fields.download.disabled, true);
  assert.equal(indicators[0].getAttribute("aria-current"), "step");
  assert.equal(invalidControl.getAttribute("aria-disabled"), "true");
  assert.equal(invalidControl.disabled, true);
  assert.equal(invalidControl.listeners.size, 0);
});

test("a choice reveals only the result and each Next unlocks one stage", () => {
  const fixture = buildPlannerFixture();
  const {
    controls,
    fields,
    indicators,
    nextButtons,
    output,
    planner,
    root,
    stageHeadings,
    stages,
  } = fixture;
  planner.enhance(root);

  assert.equal(controls[0].dispatch("click"), true);
  assert.equal(root.getAttribute("data-hive-active"), "missed-call");
  assert.equal(root.getAttribute("data-hive-stage-current"), "2");
  assert.equal(output.getAttribute("data-hive-output-cell"), "missed-call");
  assert.equal(stages[1].hidden, false);
  assert.equal(stages[1].inert, false);
  assert.equal(
    stages.slice(2).every((stage) => stage.hidden && stage.inert),
    true
  );
  assert.equal(fields.title.textContent, "Missed-call responder");
  assert.match(fields.result.textContent, /clear follow-up/u);
  assert.equal(fields.live.textContent, "Missed-call responder selected. Step 2 of 5 is ready.");
  assert.equal(stageHeadings[1].focused, true);
  assert.deepEqual(
    indicators.map((item) => item.getAttribute("data-hive-step-state")),
    ["complete", "current", "locked", "locked", "locked"]
  );
  assert.deepEqual(nextButtons.map((button) => button.disabled), [false, true, true]);

  nextButtons[0].click();
  assert.equal(root.getAttribute("data-hive-stage-current"), "3");
  assert.equal(stages[1].hidden, true);
  assert.equal(stages[1].inert, true);
  assert.equal(stages[2].hidden, false);
  assert.equal(stages[3].hidden, true);
  assert.equal(stages[4].hidden, true);
  assert.equal(stageHeadings[2].focused, true);
  assert.deepEqual(nextButtons.map((button) => button.disabled), [true, false, true]);
  assert.equal(fields.live.textContent, "Step 3 of 5 is ready.");

  nextButtons[1].click();
  assert.equal(root.getAttribute("data-hive-stage-current"), "4");
  assert.equal(stages[2].hidden, true);
  assert.equal(stages[3].hidden, false);
  assert.equal(stages[4].hidden, true);
  assert.deepEqual(nextButtons.map((button) => button.disabled), [true, true, false]);
  assert.equal(fields.pause.disabled, false);
});

test("choosing a different problem resets timing, rules, review, and pause progress", () => {
  const fixture = buildPlannerFixture();
  const {
    controls,
    fields,
    historyUrls,
    nextButtons,
    planner,
    root,
    stages,
  } = fixture;
  planner.enhance(root);
  controls[0].click();
  nextButtons[0].click();
  nextButtons[1].click();
  fields.pause.click();
  assert.equal(root.getAttribute("data-hive-paused"), "true");

  controls[3].click();
  assert.equal(root.getAttribute("data-hive-active"), "after-hours");
  assert.equal(root.getAttribute("data-hive-stage-current"), "2");
  assert.equal(root.getAttribute("data-hive-paused"), "false");
  assert.equal(fields.pause.getAttribute("aria-pressed"), "false");
  assert.equal(fields.title.textContent, "After-hours information");
  assert.match(fields.result.textContent, /approved basic information/u);
  assert.equal(stages[1].hidden, false);
  assert.equal(stages.slice(2).every((stage) => stage.hidden && stage.inert), true);
  assert.deepEqual(nextButtons.map((button) => button.disabled), [false, true, true]);
  assert.equal(historyUrls.at(-1), "/hive/#after-hours");
});

test("a valid URL hash opens that problem and later hash changes reset the flow", () => {
  const fixture = buildPlannerFixture({ hash: "#booking" });
  const {
    controls,
    fields,
    globalValues,
    planner,
    root,
    stageHeadings,
    windowListeners,
  } = fixture;
  planner.enhance(root);

  assert.equal(root.getAttribute("data-hive-active"), "booking");
  assert.equal(root.getAttribute("data-hive-stage-current"), "2");
  assert.equal(fields.title.textContent, "Booking guide");
  assert.equal(stageHeadings[1].focused, false);

  globalValues.location.hash = "#follow-up";
  windowListeners.get("hashchange")[0]();
  assert.equal(root.getAttribute("data-hive-active"), "follow-up");
  assert.equal(root.getAttribute("data-hive-stage-current"), "2");
  assert.equal(controls[4].getAttribute("aria-pressed"), "true");

  globalValues.location.hash = "#planner";
  windowListeners.get("hashchange")[0]();
  assert.equal(root.hasAttribute("data-hive-active"), false);
  assert.equal(root.getAttribute("data-hive-stage-current"), "1");
  assert.equal(fields.start.hidden, false);
});

test("pause is an honest demo state and review stays locked until step five", () => {
  const fixture = buildPlannerFixture();
  const { controls, fields, nextButtons, planner, root, stages } = fixture;
  planner.enhance(root);
  controls[5].click();
  nextButtons[0].click();
  nextButtons[1].click();

  assert.equal(fields.pause.disabled, false);
  assert.equal(fields.download.disabled, true);
  fields.pause.click();
  assert.equal(root.getAttribute("data-hive-paused"), "true");
  assert.equal(fields.pause.getAttribute("aria-pressed"), "true");
  assert.equal(fields.pause.textContent, "End pause demo");
  assert.match(fields.pauseStatus.textContent, /Pause demo on/u);
  assert.match(fields.pauseStatus.textContent, /Nothing is connected/u);

  nextButtons[2].click();
  assert.equal(root.getAttribute("data-hive-stage-current"), "5");
  assert.equal(stages[3].hidden, true);
  assert.equal(stages[4].hidden, false);
  assert.equal(fields.pause.disabled, true);
  assert.equal(fields.download.disabled, false);
  assert.equal(fields.reviewLabel.textContent, "Getting-paid reminder");
  assert.match(fields.reviewLimit.textContent, /will not make or change an invoice/u);
});

test("download creates one local JSON plan without changing the machine schema", () => {
  const fixture = buildPlannerFixture();
  const { controls, fields, globalValues, nextButtons, planner, root } = fixture;
  const blobs = [];
  const downloads = [];
  const revoked = [];
  class LocalBlob {
    constructor(parts, options) {
      this.parts = parts;
      this.options = options;
      blobs.push(this);
    }
  }
  globalValues.Blob = LocalBlob;
  globalValues.URL = {
    createObjectURL(blob) {
      assert.equal(blob, blobs[0]);
      return "blob:hive-plan";
    },
    revokeObjectURL(url) {
      revoked.push(url);
    },
  };
  globalValues.document = {
    body: {
      appendChild() {},
    },
    createElement(tagName) {
      assert.equal(tagName, "a");
      return {
        click() {
          downloads.push({ download: this.download, href: this.href });
        },
        hidden: false,
        remove() {},
      };
    },
  };
  globalValues.setTimeout = (callback) => callback();

  planner.enhance(root);
  controls[2].click();
  nextButtons[0].click();
  nextButtons[1].click();
  nextButtons[2].click();
  fields.download.click();

  assert.equal(blobs.length, 1);
  assert.equal(blobs[0].options.type, "application/json;charset=utf-8");
  const blueprint = JSON.parse(blobs[0].parts[0]);
  assert.equal(blueprint.schema, "sitesourcery.hive-blueprint.v1");
  assert.equal(blueprint.status, "planning_only");
  assert.equal(blueprint.liveIntegration, false);
  assert.equal(blueprint.cell.id, "review-request");
  assert.deepEqual(downloads, [{
    download: "hive-review-request-plan.json",
    href: "blob:hive-plan",
  }]);
  assert.deepEqual(revoked, ["blob:hive-plan"]);
  assert.match(fields.downloadStatus.textContent, /Nothing was sent or connected/u);
});

test("enhancement is idempotent", () => {
  const { controls, planner, root } = buildPlannerFixture();
  assert.equal(planner.enhance(root), 1);
  const listenerCount = controls[0].listeners.get("click").length;
  assert.equal(planner.enhance(root), 0);
  assert.equal(controls[0].listeners.get("click").length, listenerCount);
});

test("customer-facing Hive copy is short, direct, and free of internal build terms", () => {
  const planner = loadPlanner();
  const customerCopy = planner.cells
    .flatMap((cell) => Object.values(cell.customer))
    .join(" ");
  const internalTerms = [
    /\bbounded\b/iu,
    /\bartifact\b/iu,
    /\bauthority\b/iu,
    /\beffects?\b/iu,
    /\bsuppression\b/iu,
    /\bprovider mutation\b/iu,
  ];

  for (const pattern of internalTerms) {
    assert.doesNotMatch(HTML, pattern);
    assert.doesNotMatch(customerCopy, pattern);
  }
  for (const phrase of [
    "Choose one business problem",
    "See the simple result",
    "What it can do",
    "Set the timing and handoff",
    "When it starts",
    "When a person takes over",
    "Keep people in control",
    "What it will never do",
    "How to pause",
    "Review your plan",
    "A written scope and price come before anything is connected.",
    "Request written scope and price",
  ]) {
    assert.ok(HTML.includes(phrase), phrase);
  }
  assert.equal((HTML.match(/data-hive-stage="[1-5]"/gu) || []).length, 5);
  assert.equal((HTML.match(/data-hive-next="[3-5]"/gu) || []).length, 3);
  assert.match(HTML, /data-hive-activation="locked"/u);
  assert.match(
    HTML,
    /data-hive-stage="5"[^>]*aria-hidden="true"[^>]*hidden inert/iu
  );
  assert.match(CSS, /\.hive-stage-start\[hidden\][^{]*\{[^}]*display:\s*none/isu);
});

test("contains no network, persistence, markup-injection, or payment API", () => {
  const forbidden = [
    /\bfetch\s*\(/,
    /\bXMLHttpRequest\b/,
    /\bWebSocket\b/,
    /\bEventSource\b/,
    /\bsendBeacon\s*\(/,
    /\blocalStorage\b/,
    /\bsessionStorage\b/,
    /\bindexedDB\b/,
    /\bdocument\.cookie\b/,
    /\bFormData\b/,
    /\bPaymentRequest\b/,
    /\.innerHTML\b/,
    /\.outerHTML\b/,
    /\bnavigator\.clipboard\b/,
  ];

  for (const pattern of forbidden) {
    assert.doesNotMatch(SOURCE, pattern);
  }
});

test("keeps planner copy clear of prohibited deferred-state language", () => {
  const prohibitedTerm = new RegExp("\\bun" + "available\\b", "i");
  assert.doesNotMatch(SOURCE, prohibitedTerm);
});
