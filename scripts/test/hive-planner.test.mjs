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

const EXPECTED_CELL_IDS = [
  "missed-call",
  "booking",
  "review-request",
  "after-hours",
  "follow-up",
  "getting-paid",
];

function loadPlanner(extraGlobals = {}) {
  const context = vm.createContext({ ...extraGlobals });
  new vm.Script(SOURCE, { filename: SOURCE_PATH }).runInContext(context);
  return context.SiteSourceryHivePlanner;
}

class FakeElement {
  constructor(attributes = {}) {
    this.attributes = new Map(
      Object.entries(attributes).map(([name, value]) => [name, String(value)])
    );
    this.controls = [];
    this.actionFields = [];
    this.output = null;
    this.queries = new Map();
    this.listeners = new Map();
    this.textContent = "";
  }

  matches(selector) {
    return selector === "[data-hive-planner]" &&
      this.attributes.has("data-hive-planner");
  }

  querySelectorAll(selector) {
    if (selector === "[data-hive-cell]") return this.controls;
    if (selector === "[data-hive-action]") return this.actionFields;
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
    assert.equal(typeof cell.label, "string");
    assert.ok(cell.label.length > 0);
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

test("progressively enhances controls into a semantic blueprint with a working pause state", () => {
  const planner = loadPlanner();
  const root = new FakeElement({ "data-hive-planner": "" });
  const output = new FakeElement({ "data-hive-output": "" });
  const controls = EXPECTED_CELL_IDS.map(
    (cellId) => new FakeElement({ "data-hive-cell": cellId })
  );
  const invalidControl = new FakeElement({ "data-hive-cell": "__proto__" });
  const fields = {
    status: new FakeElement({ "data-hive-status": "" }),
    live: new FakeElement({
      "data-hive-live": "",
      role: "status",
      "aria-live": "polite",
      "aria-atomic": "true",
    }),
    title: new FakeElement({ "data-hive-title": "" }),
    problem: new FakeElement({ "data-hive-problem": "" }),
    trigger: new FakeElement({ "data-hive-trigger": "" }),
    boundary: new FakeElement({ "data-hive-boundary": "" }),
    consent: new FakeElement({ "data-hive-consent": "" }),
    handoff: new FakeElement({ "data-hive-handoff": "" }),
    killSwitch: new FakeElement({ "data-hive-kill-switch": "" }),
    pause: new FakeElement({ "data-hive-pause": "" }),
    pauseStatus: new FakeElement({ "data-hive-pause-status": "" }),
    download: new FakeElement({ "data-hive-download": "" }),
  };
  root.controls = [...controls, invalidControl];
  root.actionFields = [
    new FakeElement({ "data-hive-action": "" }),
    new FakeElement({ "data-hive-action": "" }),
    new FakeElement({ "data-hive-action": "" }),
  ];
  root.output = output;
  for (const [name, field] of Object.entries(fields)) {
    const attribute = name === "killSwitch"
      ? "kill-switch"
      : name === "pauseStatus"
        ? "pause-status"
        : name.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`);
    root.queries.set(`[data-hive-${attribute}]`, field);
  }

  assert.equal(planner.enhance(root), 1);
  assert.equal(root.getAttribute("data-hive-planner-ready"), "true");
  assert.equal(root.getAttribute("data-hive-active"), "missed-call");
  assert.equal(output.hasAttribute("aria-live"), false);
  assert.equal(fields.live.getAttribute("role"), "status");
  assert.equal(fields.live.getAttribute("aria-live"), "polite");
  assert.equal(fields.live.getAttribute("aria-atomic"), "true");
  assert.equal(fields.live.textContent, "Missed-call responder selected.");
  assert.equal(fields.title.textContent, "Missed-call responder");
  assert.match(fields.problem.textContent, /legitimate caller/u);
  assert.match(fields.trigger.textContent, /inbound call/u);
  assert.equal(root.actionFields.every((field) => field.textContent.length > 20), true);
  assert.equal(fields.pause.getAttribute("aria-pressed"), "false");
  assert.equal(root.getAttribute("data-hive-paused"), "false");
  assert.equal(controls[0].getAttribute("aria-pressed"), "true");
  assert.equal(invalidControl.getAttribute("aria-disabled"), "true");
  assert.equal(invalidControl.listeners.size, 0);

  assert.equal(controls[3].dispatch("click"), true);
  assert.equal(root.getAttribute("data-hive-active"), "after-hours");
  assert.equal(
    output.getAttribute("data-hive-output-cell"),
    "after-hours"
  );
  assert.equal(fields.title.textContent, "After-hours information");
  assert.equal(fields.live.textContent, "After-hours information selected.");
  assert.match(fields.boundary.textContent, /Never provide emergency/u);
  assert.equal(controls[0].getAttribute("aria-pressed"), "false");
  assert.equal(controls[3].getAttribute("aria-pressed"), "true");
  assert.equal(controls[3].getAttribute("data-hive-selected"), "true");

  fields.pause.dispatch("click");
  assert.equal(root.getAttribute("data-hive-paused"), "true");
  assert.equal(fields.pause.getAttribute("aria-pressed"), "true");
  assert.equal(fields.pause.textContent, "Resume this cell");
  assert.match(fields.pauseStatus.textContent, /No next effect/u);

  controls[0].dispatch("click");
  assert.equal(root.getAttribute("data-hive-paused"), "false");
  controls[3].dispatch("click");
  assert.equal(root.getAttribute("data-hive-paused"), "true");
  assert.equal(fields.download.listeners.get("click").length, 1);

  const listenerCount = controls[0].listeners.get("click").length;
  assert.equal(planner.enhance(root), 0);
  assert.equal(controls[0].listeners.get("click").length, listenerCount);
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
