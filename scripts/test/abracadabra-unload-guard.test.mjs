import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

/*
 * Behavioural proof for the unload guard.
 *
 * Made versions live only in the tab's memory, and making one marks the draft
 * clean. Before the fix that combination silently disarmed beforeunload at the
 * exact moment the customer had something irreplaceable, so these tests drive
 * the real shipped source through three states and assert what the browser
 * would actually do.
 *
 * The app source is an IIFE that returns early under CommonJS, so it is run in
 * a vm context with a DOM shim rather than required.
 */

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const makerPath = path.join(projectRoot, "abracadabra/app/abracadabra-app.js");
const compilerPath = path.join(projectRoot, "abracadabra/app/abracadabra-compiler.js");
const [makerSource, compilerSource] = await Promise.all([
  readFile(makerPath, "utf8"),
  readFile(compilerPath, "utf8"),
]);

/* ----------------------------- DOM shim ------------------------------ */

function descendants(node) {
  const out = [];
  for (const child of node.children) {
    out.push(child);
    out.push(...descendants(child));
  }
  return out;
}

function matches(node, selector) {
  for (const part of selector.split(",").map((piece) => piece.trim())) {
    if (matchesOne(node, part)) return true;
  }
  return false;
}

function matchesOne(node, selector) {
  let rest = selector;
  const tagMatch = /^[a-z]+/u.exec(rest);
  if (tagMatch) {
    if (node.tag !== tagMatch[0]) return false;
    rest = rest.slice(tagMatch[0].length);
  }
  if (rest.endsWith(":checked")) {
    if (!node.checked) return false;
    rest = rest.slice(0, -":checked".length);
  }
  for (const attr of rest.matchAll(/\[([a-zA-Z-]+)(?:="([^"]*)")?\]/gu)) {
    const [, name, value] = attr;
    if (!(name in node.attributes)) return false;
    if (value !== undefined && String(node.attributes[name]) !== value) return false;
  }
  return true;
}

function el(tag, attributes = {}, children = []) {
  const node = {
    tag,
    attributes: { ...attributes },
    children,
    value: attributes.value === undefined ? "" : String(attributes.value),
    checked: Boolean(attributes.checked),
    hidden: false,
    disabled: false,
    inert: false,
    textContent: "",
    listeners: Object.create(null),
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    style: {},
    getAttribute(name) {
      return name in this.attributes ? String(this.attributes[name]) : null;
    },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    removeAttribute(name) { delete this.attributes[name]; },
    hasAttribute(name) { return name in this.attributes; },
    addEventListener(type, handler) {
      (this.listeners[type] = this.listeners[type] || []).push(handler);
    },
    removeEventListener() {},
    dispatch(type, event) {
      for (const handler of this.listeners[type] || []) handler(event);
    },
    click() {
      this.dispatch("click", { type: "click", isTrusted: true, target: this });
    },
    focus() {},
    blur() {},
    scrollIntoView() {},
    replaceChildren(...nodes) { this.children = nodes.flat(); },
    append(...nodes) { this.children.push(...nodes.flat()); },
    appendChild(child) { this.children.push(child); return child; },
    querySelector(selector) {
      return descendants(this).find((n) => matches(n, selector)) || null;
    },
    querySelectorAll(selector) {
      return descendants(this).filter((n) => matches(n, selector));
    },
    closest() { return null; },
  };
  return node;
}

const FIELDS = [
  "businessName", "summary", "about", "offerings", "location",
  "hours", "phone", "email", "website", "primaryAction",
];

function buildDocument() {
  const byId = Object.create(null);

  const field = (name, tag = "input") => {
    const node = el(tag, { name });
    byId[name] = node;
    return node;
  };

  const themeClear = el("input", { name: "theme", value: "clear", type: "radio" });
  const themeWarm = el("input", { name: "theme", value: "warm", type: "radio" });
  themeClear.checked = true;

  const truthConfirmed = el("input", { id: "truth-confirmed", type: "checkbox" });

  const steps = ["facts", "vibe", "truth", "preview"].map((name) =>
    el("section", { "data-step": name })
  );
  const progress = ["facts", "vibe", "truth", "preview"].map((name) =>
    el("li", { "data-progress-step": name })
  );

  const errorsList = el("ul");
  const errorsBox = el("div", { id: "spark-errors" }, [errorsList]);

  const controls = {
    previousVersion: el("button", { id: "previous-version" }),
    openVersion: el("button", { id: "open-version" }),
    downloadVersion: el("button", { id: "download-version" }),
    makePreview: el("button", { id: "make-preview" }),
    returnBar: el("div", { "data-return-bar": "" }),
    returnPreview: el("button", { "data-return-preview": "" }),
    loadSample: el("button", { "data-load-sample": "" }),
    clearDraft: el("button", { "data-clear-draft": "" }),
    editFacts: el("button", { "data-edit-facts": "" }),
    editLook: el("button", { "data-edit-look": "" }),
    next: el("button", { "data-next": "vibe" }),
    back: el("button", { "data-back": "facts" }),
  };

  const maker = el("div", { id: "spark-maker" }, [
    ...FIELDS.map((name) => field(name, name === "primaryAction" ? "select" : "input")),
    themeClear,
    themeWarm,
    truthConfirmed,
    ...steps,
    ...progress,
    errorsBox,
    ...Object.values(controls),
  ]);

  const singles = {
    "spark-maker": maker,
    "spark-boot-status": el("p", { id: "spark-boot-status" }),
    "spark-errors": errorsBox,
    "spark-truth-review": el("div", { id: "spark-truth-review" }),
    "truth-confirmed": truthConfirmed,
    "spark-preview": el("iframe", { id: "spark-preview" }),
    "spark-version-status": el("p", { id: "spark-version-status" }),
    "spark-version-list": el("div", { id: "spark-version-list" }),
    "previous-version": controls.previousVersion,
    "open-version": controls.openVersion,
    "download-version": controls.downloadVersion,
    "make-preview": controls.makePreview,
  };

  const documentObject = {
    getElementById(id) { return singles[id] || byId[id] || null; },
    querySelector(selector) { return maker.querySelector(selector); },
    querySelectorAll(selector) { return maker.querySelectorAll(selector); },
    createElement(tag) { return el(tag); },
    body: el("body"),
  };

  return { documentObject, maker, truthConfirmed, controls, fields: byId };
}

/* --------------------------- boot the real app ------------------------ */

function bootMaker() {
  const dom = buildDocument();
  const unloadHandlers = [];

  const context = vm.createContext({
    console,
    CustomEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init); } },
    URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
    Blob: class {},
    setTimeout,
    clearTimeout,
    TextEncoder,
    crypto: globalThis.crypto,
  });
  context.globalThis = context;
  context.document = dom.documentObject;
  context.addEventListener = (type, handler) => {
    if (type === "beforeunload") unloadHandlers.push(handler);
  };
  context.dispatchEvent = () => true;
  context.confirm = () => true;
  context.window = context;

  new vm.Script(compilerSource, { filename: compilerPath }).runInContext(context);
  new vm.Script(makerSource, { filename: makerPath }).runInContext(context);

  assert.ok(context.AbracadabraCompiler, "compiler must load");
  assert.equal(unloadHandlers.length, 1, "exactly one beforeunload handler must register");

  /** Fire beforeunload the way a browser does; report whether it was blocked. */
  function unloadIsBlocked() {
    let prevented = false;
    const event = {
      type: "beforeunload",
      returnValue: undefined,
      preventDefault() { prevented = true; },
    };
    unloadHandlers[0](event);
    return prevented && event.returnValue === "";
  }

  function typeInto(name, text) {
    const control = dom.fields[name];
    control.value = text;
    dom.maker.dispatch("input", { type: "input", isTrusted: true, target: control });
  }

  function makeVersion(overrides = {}) {
    const facts = {
      businessName: "Bright Spark Electric",
      summary: "Licensed electrician serving nearby streets and small shops.",
      about: "A small electrical business handling repairs, upgrades, and callouts.",
      offerings: "Repairs, fuse boards, outdoor sockets",
      location: "Mickleton",
      hours: "Weekdays 8am to 5pm",
      phone: "8565550100",
      email: "owner@example.com",
      ...overrides,
    };
    for (const [name, text] of Object.entries(facts)) typeInto(name, text);
    // First click arms the review snapshot; the second makes the version.
    dom.controls.makePreview.click();
    dom.truthConfirmed.checked = true;
    dom.controls.makePreview.click();
  }

  const api = () => context.window.SiteSourceryAbracadabraMaker;

  return { ...dom, unloadIsBlocked, typeInto, makeVersion, api, context };
}

/* -------------------------------- tests ------------------------------- */

test("clean blank draft does not block unload", () => {
  const app = bootMaker();
  assert.equal(
    app.unloadIsBlocked(),
    false,
    "a blank untouched maker must let the customer leave without a prompt"
  );
});

test("dirty draft blocks unload", () => {
  const app = bootMaker();
  app.typeInto("businessName", "Bright Spark Electric");
  assert.equal(
    app.unloadIsBlocked(),
    true,
    "unsaved trusted edits must still raise the browser prompt"
  );
});

test("a newly made, unsaved version blocks unload even though making it marks the draft clean", () => {
  const app = bootMaker();
  app.makeVersion();

  const current = app.api().getCurrentVersion();
  assert.ok(current, "the drive must actually produce a version");
  assert.ok(!current.platformVersionId, "a freshly made version must start unsaved");

  // The regression: making a version calls markDraftClean(), so the draft-level
  // predicate is false here. The guard must fire anyway.
  assert.equal(
    app.unloadIsBlocked(),
    true,
    "an unsaved made version lives only in memory, so unload must be blocked"
  );
});

test("once the only version is platform-marked and the draft is clean, unload no longer blocks", () => {
  const app = bootMaker();
  app.makeVersion();
  assert.equal(app.unloadIsBlocked(), true, "precondition: unsaved version blocks");

  // This is what a signed-in hosted customer gets after acceptMadeVersion succeeds.
  app.api().markCurrentPlatformVersion("ver_hosted_1");
  assert.equal(
    app.api().getCurrentVersion().platformVersionId,
    "ver_hosted_1",
    "the version must actually be marked durable"
  );

  assert.equal(
    app.unloadIsBlocked(),
    false,
    "durably saved work plus a clean draft must not raise a false warning"
  );
});

test("a restored project of saved versions does not block unload", () => {
  const source = bootMaker();
  source.makeVersion();
  const made = source.api().getCurrentVersion();

  const project = {
    id: "project_1",
    serving: { currentVersionId: "ver_saved_1" },
    versions: [{
      id: "ver_saved_1",
      rawFacts: made.raw,
      artifact: { digest: made.result.artifactDigest, html: made.result.html },
    }],
  };

  const app = bootMaker();
  assert.notEqual(app.api().loadProject(project), false, "a clean draft must not refuse the project");
  const restored = app.api().getCurrentVersion();
  assert.ok(restored, "the project must restore at least one version");
  assert.equal(restored.platformVersionId, "ver_saved_1", "restored versions carry their platform id");

  assert.equal(
    app.unloadIsBlocked(),
    false,
    "a restored project whose versions are all platform-marked must not block"
  );
});

test("an empty or whitespace platform id does not count as durable", () => {
  for (const rejected of ["", "   ", "\t\n"]) {
    const app = bootMaker();
    app.makeVersion();
    app.api().markCurrentPlatformVersion(rejected);

    assert.equal(
      app.api().getCurrentVersion().platformVersionId,
      rejected,
      "the id must be stored verbatim so the guard is what rejects it"
    );
    assert.equal(
      app.unloadIsBlocked(),
      true,
      `a platform id of ${JSON.stringify(rejected)} means acceptance did not land, so unload must still block`
    );
  }
});

test("an older unsaved version still blocks even when the current one is marked saved", () => {
  const app = bootMaker();
  app.makeVersion();
  app.makeVersion({ businessName: "Bright Spark Electric North", location: "Woodbury" });

  // Mark only the current (second) version as accepted by the platform.
  app.api().markCurrentPlatformVersion("ver_hosted_2");
  assert.equal(app.api().getCurrentVersion().platformVersionId, "ver_hosted_2");

  assert.equal(
    app.unloadIsBlocked(),
    true,
    "the earlier version is still memory-only, so unload must keep blocking"
  );
});

test("an unsaved version keeps blocking unload after the draft is edited and re-cleaned", () => {
  const app = bootMaker();
  app.makeVersion();
  app.typeInto("hours", "Weekends by appointment");
  assert.equal(app.unloadIsBlocked(), true, "dirty draft plus a version still blocks");

  // Clearing the draft is an in-tab action that made versions survive.
  app.controls.clearDraft.click();
  assert.equal(
    app.unloadIsBlocked(),
    true,
    "clearing the draft must not disarm the guard while an unsaved version exists"
  );
});

test("draft-replacement confirmations are unchanged by the fix", () => {
  const app = bootMaker();
  const prompts = [];
  app.context.confirm = (message) => { prompts.push(message); return true; };

  // A clean blank draft must not prompt when loading the sample.
  app.controls.loadSample.click();
  assert.deepEqual(prompts, [], "a clean draft must replace silently");

  // A dirty draft must prompt, and the prompt must still be about draft edits.
  app.typeInto("businessName", "Changed after sample");
  app.controls.clearDraft.click();
  assert.equal(prompts.length, 1, "a dirty draft must still confirm before replacement");
  assert.match(prompts[0], /unsaved edits will be removed/u);
  assert.match(
    prompts[0],
    /made versions will stay available/u,
    "the promise that versions survive in-tab replacement must be intact"
  );
});
