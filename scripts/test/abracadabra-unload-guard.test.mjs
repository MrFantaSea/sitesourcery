import assert from "node:assert/strict";
import { createRequire } from "node:module";
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

const require = createRequire(import.meta.url);
// The shipped hosted caller's own identity helper, not a copy of it.
const hostedDomPath = "../../abracadabra/app/abracadabra-hosted-control-dom.js";
const { bindAcceptedPlatformVersion, originArtifactDigest } = require(hostedDomPath);

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
  const madeDetails = [];
  const selectedDetails = [];
  context.dispatchEvent = (event) => {
    if (event && event.type === "abracadabra:versionmade" && event.detail) {
      madeDetails.push(JSON.parse(JSON.stringify(event.detail)));
    }
    if (
      event
      && event.type ===
        "abracadabra:versionselected"
      && event.detail
    ) {
      selectedDetails.push(
        JSON.parse(JSON.stringify(event.detail))
      );
    }
    return true;
  };
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

  /** The exact detail the maker emits, as a hosted caller would receive it. */
  function lastMadeDetail() {
    return madeDetails[madeDetails.length - 1] || null;
  }

  return {
    ...dom, unloadIsBlocked, typeInto, makeVersion, api, context,
    madeDetails, selectedDetails, lastMadeDetail,
  };
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
  app.api().markPlatformVersion(app.lastMadeDetail().result.artifactDigest, "ver_hosted_1");
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

test("re-making an unchanged saved version selects it without creating another server write", () => {
  const source = bootMaker();
  source.makeVersion();
  const made = source.api().getCurrentVersion();
  const app = bootMaker();
  assert.equal(
    app.api().loadProject({
      id: "project_1",
      serving: {
        currentVersionId: "ver_saved_1"
      },
      versions: [{
        id: "ver_saved_1",
        rawFacts: made.raw,
        artifact: {
          digest:
            made.result.artifactDigest,
          html: made.result.html
        }
      }]
    }),
    true
  );
  const writesBefore = app.madeDetails.length;
  app.makeVersion();
  assert.equal(
    app.madeDetails.length,
    writesBefore,
    "restoring identical saved bytes cannot emit another versionmade write"
  );
  assert.equal(
    app.selectedDetails.at(-1)
      .platformVersionId,
    "ver_saved_1"
  );
});

test("an empty or whitespace platform id does not count as durable", () => {
  for (const rejected of ["", "   ", "\t\n"]) {
    const app = bootMaker();
    app.makeVersion();
    assert.equal(
      app.api().markPlatformVersion(app.lastMadeDetail().result.artifactDigest, rejected),
      false,
      `the marker itself must refuse ${JSON.stringify(rejected)}`
    );

    assert.ok(
      !app.api().getCurrentVersion().platformVersionId,
      "a non-durable id must be refused without mutating the version"
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
  app.api().markPlatformVersion(app.lastMadeDetail().result.artifactDigest, "ver_hosted_2");
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

/* ------------------- exact identity binding (the P1 race) ------------------- */

test("a late acceptance marks its originating version, not whichever is current", () => {
  const app = bootMaker();

  app.makeVersion();
  const digestA = app.lastMadeDetail().result.artifactDigest;

  // The customer keeps working while A's acceptance is still in flight.
  app.makeVersion({ businessName: "Bright Spark Electric North", location: "Woodbury" });
  const digestB = app.lastMadeDetail().result.artifactDigest;
  assert.notEqual(digestA, digestB, "the two versions must have distinct identities");

  // A's acceptance resolves now, long after B became current.
  assert.equal(
    app.api().markPlatformVersion(digestA, "ver_A"),
    true,
    "the originating version must still be findable by its own identity"
  );

  const current = app.api().getCurrentVersion();
  assert.ok(!current.platformVersionId, "B is current and was never saved, so it must stay unmarked");
  assert.equal(
    app.unloadIsBlocked(),
    true,
    "B is still memory-only, so unload must remain blocked"
  );

  // A really did receive the id: it can be selected back by its server id.
  assert.equal(app.api().selectPlatformVersion("ver_A"), true, "A must be selectable by its server id");
  assert.equal(
    app.api().getCurrentVersion().platformVersionId,
    "ver_A",
    "selecting by server id must return the originating version"
  );
});

test("unload disarms only once both versions carry their own ids", () => {
  const app = bootMaker();
  app.makeVersion();
  const digestA = app.lastMadeDetail().result.artifactDigest;
  app.makeVersion({ businessName: "Bright Spark Electric North", location: "Woodbury" });
  const digestB = app.lastMadeDetail().result.artifactDigest;

  app.api().markPlatformVersion(digestA, "ver_A");
  assert.equal(app.unloadIsBlocked(), true, "one still unsaved");

  assert.equal(app.api().markPlatformVersion(digestB, "ver_B"), true);
  assert.equal(
    app.unloadIsBlocked(),
    false,
    "with every version durably marked and the draft clean, unload must not block"
  );
});

test("an unknown local identity mutates nothing and cannot disarm the guard", () => {
  const app = bootMaker();
  app.makeVersion();
  const digestA = app.lastMadeDetail().result.artifactDigest;

  const flippedLast = digestA.slice(0, -1) + (digestA.endsWith("0") ? "1" : "0");
  assert.notEqual(flippedLast, digestA, "the near-miss digest must differ from the real one");
  for (const unknown of ["", null, undefined, "not-a-digest", flippedLast]) {
    assert.equal(
      app.api().markPlatformVersion(unknown, "ver_ghost"),
      false,
      `an unknown identity ${JSON.stringify(unknown)} must be refused`
    );
  }

  assert.ok(
    !app.api().getCurrentVersion().platformVersionId,
    "no refused call may fall back to stamping the current version"
  );
  assert.equal(app.unloadIsBlocked(), true, "refused marks cannot disarm the guard");

  // The real identity still works afterwards, so nothing was corrupted.
  assert.equal(app.api().markPlatformVersion(digestA, "ver_A"), true);
  assert.equal(app.unloadIsBlocked(), false);
});

test("loadProject replaces a stale unsaved version and disarms", () => {
  const source = bootMaker();
  source.makeVersion();
  const made = source.api().getCurrentVersion();

  const app = bootMaker();
  app.makeVersion({ businessName: "Stale Local Draft Co", location: "Nowhere" });
  const staleDigest = app.lastMadeDetail().result.artifactDigest;
  assert.equal(app.unloadIsBlocked(), true, "precondition: armed by an unsaved local version");

  assert.notEqual(app.api().loadProject({
    id: "project_1",
    serving: { currentVersionId: "ver_saved_1" },
    versions: [{
      id: "ver_saved_1",
      rawFacts: made.raw,
      artifact: { digest: made.result.artifactDigest, html: made.result.html },
    }],
  }), false);

  assert.equal(
    app.api().markPlatformVersion(staleDigest, "ver_ghost"),
    false,
    "the stale local version must be gone, not merely hidden"
  );
  assert.equal(app.api().getCurrentVersion().platformVersionId, "ver_saved_1");
  assert.equal(
    app.unloadIsBlocked(),
    false,
    "a project of durably saved versions must disarm the guard"
  );
});

test("an unsaved made version does not add a draft-replacement prompt", () => {
  const app = bootMaker();
  const prompts = [];
  app.context.confirm = (message) => { prompts.push(message); return true; };

  app.makeVersion();
  assert.equal(app.unloadIsBlocked(), true, "the version is unsaved, so unload still blocks");

  // Making a version leaves the draft clean, so these in-tab actions must stay silent.
  app.controls.loadSample.click();
  app.controls.clearDraft.click();
  app.api().loadProject({ id: "p", versions: [] });

  assert.deepEqual(
    prompts,
    [],
    "in-tab replacement prompts stay draft-only; an unsaved version must not add one"
  );
});

/* ----------------------- caller-level binding proof ----------------------- */

/*
 * Both shipped listeners do exactly this: read originArtifactDigest(detail)
 * before awaiting acceptance, then hand the originating digest and the exact
 * accepted result to bindAcceptedPlatformVersion. Both functions here are the
 * shipped ones, and the binding helper performs the real validation and the
 * real maker.markPlatformVersion call.
 */
function shippedAcceptanceSequence(app, detail, acceptance) {
  const originDigest = originArtifactDigest(detail);
  return acceptance.then((version) =>
    bindAcceptedPlatformVersion(app.api(), originDigest, version));
}

test("caller: a delayed acceptance marks the originating digest, not the current version", async () => {
  const app = bootMaker();

  app.makeVersion();
  const detailA = app.lastMadeDetail();
  let resolveA;
  const inFlight = shippedAcceptanceSequence(
    app,
    detailA,
    new Promise((resolve) => { resolveA = resolve; })
  );

  // The customer makes B while A's acceptance is still outstanding.
  app.makeVersion({ businessName: "Bright Spark Electric North", location: "Woodbury" });
  assert.ok(!app.api().getCurrentVersion().platformVersionId, "B starts unsaved");

  resolveA({ id: "ver_A" });
  assert.equal(await inFlight, "bound");

  assert.ok(
    !app.api().getCurrentVersion().platformVersionId,
    "the in-flight acceptance must not stamp B, which is merely current"
  );
  assert.equal(app.unloadIsBlocked(), true, "B is still memory-only");
  assert.equal(app.api().selectPlatformVersion("ver_A"), true, "A received the id");
});

test("caller: a null or id-less acceptance marks nothing", async () => {
  for (const bad of [null, {}, { id: "" }, { id: "   " }]) {
    const app = bootMaker();
    app.makeVersion();
    const detail = app.lastMadeDetail();

    const outcome = await shippedAcceptanceSequence(app, detail, Promise.resolve(bad));
    assert.equal(outcome, "unaccepted", `acceptance ${JSON.stringify(bad)} must be refused`);
    assert.ok(
      !app.api().getCurrentVersion().platformVersionId,
      "a refused acceptance must leave the version unmarked"
    );
    assert.equal(app.unloadIsBlocked(), true, "and must not disarm the guard");
  }
});

test("caller: an acceptance for a version the customer already discarded is refused", async () => {
  const app = bootMaker();
  app.makeVersion();
  const detailA = app.lastMadeDetail();

  // The project is reloaded from the server, dropping the local-only version.
  app.api().loadProject({ id: "project_1", versions: [] });

  const outcome = await shippedAcceptanceSequence(app, detailA, Promise.resolve({ id: "ver_A" }));
  assert.equal(outcome, "stale", "the originating version is gone, so nothing may be marked");
});

test("an already-bound version keeps its first id and refuses a conflicting one", () => {
  const app = bootMaker();
  app.makeVersion();
  const digest = app.lastMadeDetail().result.artifactDigest;

  assert.equal(app.api().markPlatformVersion(digest, "ver_first"), true);
  assert.equal(app.unloadIsBlocked(), false, "durable after the first bind");

  // Re-reporting the same acceptance is idempotent, not an error.
  assert.equal(
    app.api().markPlatformVersion(digest, "ver_first"),
    true,
    "the same id reported twice must be an idempotent success"
  );

  // A second, different id is a conflict. The first binding stands.
  assert.equal(
    app.api().markPlatformVersion(digest, "ver_second"),
    false,
    "a conflicting id must be refused, not silently overwrite the binding"
  );
  assert.equal(
    app.api().getCurrentVersion().platformVersionId,
    "ver_first",
    "the original binding must survive the refused conflict"
  );
  assert.equal(app.api().selectPlatformVersion("ver_first"), true);
});

/* ------------- listener binding invariants (regression tripwires) ------------- */

const hostedDomSource = await readFile(
  path.join(projectRoot, "abracadabra/app/abracadabra-hosted-control-dom.js"),
  "utf8"
);

/** The source of one listener/handler, sliced between stable anchors. */
function region(startAnchor, endAnchor) {
  const start = hostedDomSource.indexOf(startAnchor);
  assert.notEqual(start, -1, `anchor not found: ${startAnchor}`);
  const end = hostedDomSource.indexOf(endAnchor, start);
  assert.notEqual(end, -1, `end anchor not found after ${startAnchor}`);
  return hostedDomSource.slice(start, end);
}

test("binding: the old current-version marker is gone and there is one marker call site", () => {
  assert.equal(
    (hostedDomSource.match(/markCurrentPlatformVersion/gu) || []).length,
    0,
    "no adoption path may call the removed current-version marker"
  );
  assert.equal(
    (hostedDomSource.match(/markPlatformVersion\(/gu) || []).length,
    1,
    "exactly one call site, so no path can bind outside the shared helper"
  );
  assert.match(
    region("function bindAcceptedPlatformVersion", "\n  }"),
    /markPlatformVersion\(/u,
    "that one call site must be inside the shared binding helper"
  );
});

test("binding: the immediate save listener captures the digest before awaiting", () => {
  const listener = region('window.addEventListener("abracadabra:versionmade"', "\n  });");

  const capture = listener.indexOf("originArtifactDigest(event.detail)");
  const await_ = listener.indexOf("control.acceptMadeVersion(event.detail)");
  assert.notEqual(capture, -1, "the listener must capture the originating digest");
  assert.ok(
    capture < await_,
    "the digest must be captured before acceptance is awaited, or the race returns"
  );
  assert.match(
    listener,
    /if \(!adoptPlatformVersion\(originDigest, version\)\) return;\s*announce\("Version saved to your account\.", "success"\)/u,
    "saved success must be unreachable when exact adoption fails"
  );
  assert.doesNotMatch(listener, /selectedVersionId/u, "no current-selection fallback");
});

test("binding: pending-guest adoption captures its own digest and never falls back", () => {
  const handler = region('one("[data-create-project]")', '\n  one("[data-toggle-settings]")');

  const capture = handler.indexOf("originArtifactDigest(candidate)");
  const await_ = handler.indexOf("await control.acceptMadeVersion(candidate)");
  assert.ok(capture !== -1 && capture < await_, "digest captured before the await");
  assert.match(
    handler,
    /bindAcceptedPlatformVersion\(maker, candidateDigest, accepted\)/u,
    "it must bind the candidate's own digest to the exact accepted result"
  );
  assert.doesNotMatch(
    handler,
    /selectedVersionId/u,
    "the removed current-selection fallback must not return"
  );
});

test("binding: project creation cannot announce success unconditionally", () => {
  const handler = region('one("[data-create-project]")', '\n  one("[data-toggle-settings]")');

  assert.doesNotMatch(
    handler,
    /\}\s*,\s*"Project saved to your account\."\s*\)/u,
    "the success string must not be passed to run(), which announces it unconditionally"
  );
  const bound = handler.indexOf('outcome === "bound"');
  const success = handler.indexOf('"Project saved to your account. Your preview is saved to it."');
  assert.ok(
    bound !== -1 && success > bound,
    "the saved-with-preview success must sit inside the bound branch"
  );
  assert.match(
    handler,
    /could not be linked to it/u,
    "a failed adoption must produce truthful copy, not a success"
  );
});

/* ------------- pending-guest adoption failure is not a success ------------- */

test("a pending-guest adoption that fails cannot report the preview as saved", () => {
  const app = bootMaker();
  app.makeVersion();
  const candidate = app.lastMadeDetail();
  const candidateDigest = originArtifactDigest(candidate);

  // Every way the acceptance can come back unusable, plus a stale local version.
  for (const accepted of [null, undefined, {}, { id: "" }, { id: "   " }]) {
    assert.notEqual(
      bindAcceptedPlatformVersion(app.api(), candidateDigest, accepted),
      "bound",
      `acceptance ${JSON.stringify(accepted)} must not report as bound`
    );
  }

  // The preview is still local, still unsaved, and still guarded.
  assert.ok(!app.api().getCurrentVersion().platformVersionId);
  assert.equal(
    app.unloadIsBlocked(),
    true,
    "an unlinked preview must keep the unload guard armed"
  );

  // And a genuinely stale candidate reports stale, not bound.
  app.api().loadProject({ id: "p", versions: [] });
  assert.equal(
    bindAcceptedPlatformVersion(app.api(), candidateDigest, { id: "ver_x" }),
    "stale"
  );
});

test("only the accepted version's own string id is honoured, never a foreign id", () => {
  const app = bootMaker();
  app.makeVersion();
  const digest = originArtifactDigest(app.lastMadeDetail());

  // Every one of these is a wrong-shaped acceptance. The generic idOf() would
  // have happily returned an id for most of them.
  const foreign = [
    { projectId: "project_2" },
    { quoteId: "quote_9" },
    { orderId: "order_3" },
    { domainOrderId: "dord_1" },
    { contactId: "contact_7" },
    { registrantContactId: "rc_1" },
    { priceCheckId: "pc_1" },
    { domainId: "dom_1" },
    { versionId: "ver_nested" },
    { version: { id: "ver_nested" } },
    { data: { version: { id: "ver_nested" } } },
    { id: 42 },
    { id: {} },
    { id: ["ver_1"] },
    { id: null },
  ];

  for (const accepted of foreign) {
    assert.equal(
      bindAcceptedPlatformVersion(app.api(), digest, accepted),
      "unaccepted",
      `${JSON.stringify(accepted)} must not be treated as a version id`
    );
    assert.ok(
      !app.api().getCurrentVersion().platformVersionId,
      `${JSON.stringify(accepted)} must not mutate the version`
    );
    assert.equal(
      app.unloadIsBlocked(),
      true,
      `${JSON.stringify(accepted)} must not disarm the guard`
    );
  }

  // A correctly shaped acceptance still binds.
  assert.equal(bindAcceptedPlatformVersion(app.api(), digest, { id: "ver_real" }), "bound");
  assert.equal(app.unloadIsBlocked(), false);
});

test("binding: the shared helper does not reach for the generic id resolver", () => {
  const helper = region("function acceptedPlatformVersionId", "\n  }");
  assert.doesNotMatch(helper, /idOf\(/u, "the generic id resolver must not be used here");
  assert.match(helper, /typeof id !== "string"/u, "a non-string id must be refused");
  for (const foreign of ["projectId", "quoteId", "orderId", "versionId", "contactId"]) {
    assert.doesNotMatch(
      helper,
      new RegExp(foreign, "u"),
      `${foreign} must not be readable as a version id`
    );
  }
});
