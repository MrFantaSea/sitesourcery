import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  lstat,
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  routesFromArtifactSitemap,
  verifyArtifactLinkGraph,
} from "../audit-artifact-from-sitemap.mjs";
import {
  artifactPath,
  HOME_FIRST_PAINT_CHECKPOINTS,
  HOME_FIRST_PAINT_SCENARIOS,
  HOME_FIRST_PAINT_VIEWPORTS,
  homeFirstPaintFailures,
  HIVE_CUSTOMER_EXAMPLES,
  HIVE_CUSTOMER_FIELDS,
  HIVE_FORBIDDEN_PUBLIC_FIELDS,
  PRIMARY_NAV_CONTRACT,
  primaryNavContractFailures,
  privateViewerPopupFailures,
  PROGRESSIVE_DISCLOSURE_COUNTS,
  PROGRESSIVE_FAILURE_SCENARIOS,
  PROGRESSIVE_FAILURE_VIEWPORT,
  progressiveFailureFailures,
  PROGRESSIVE_REVEAL_ROUTES,
  REVIEWED_CHROMIUM,
  START_BACK_TABLE,
  START_BRANCH_TABLE,
  START_DECISION_TABLE,
  START_INITIAL_TABLE,
  waitForPrivateViewerAttachment,
} from "../browser-audit-vnext.mjs";
import { buildContainedArtifact } from "../build-contained-artifact.mjs";
import {
  CANONICAL_ROUTES,
  PRIMARY_NAV as ROUTE_PRIMARY_NAV,
} from "../check-routes.mjs";
import {
  assertExactWorktreeDeletion,
  prepareContainment,
} from "../prepare-containment.mjs";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = path.resolve(TEST_DIRECTORY, "../..");
const CANDIDATE_BASE_SHA = "181922184afb55b044569b34cf345bf079ecf998";
const PRODUCTION_PREDECESSOR_SHA = "eff8195640db58390d03eefbe863248220994e37";
const INSTALL_COMMAND = 'bash scripts/install-reviewed-chromium.sh "$RUNNER_TEMP/reviewed-chromium" "$GITHUB_ENV"';
const CONTROL_AUDIT_COMMAND = "node control/scripts/audit-artifact-from-sitemap.mjs target/_site";
const WORKFLOWS = Object.freeze([
  ".github/workflows/containment.yml",
  ".github/workflows/pages.yml",
  ".github/workflows/public-truth-reconciliation.yml",
  ".github/workflows/site-quality.yml",
]);

const [
  packageSource,
  packageLockSource,
  pinnedNodeSource,
  auditSource,
  installerSource,
  vnextScriptSource,
  vnextStyleSource,
] = await Promise.all([
  readFile(path.join(SITE_ROOT, "package.json"), "utf8"),
  readFile(path.join(SITE_ROOT, "package-lock.json"), "utf8"),
  readFile(path.join(SITE_ROOT, ".nvmrc"), "utf8"),
  readFile(path.join(SITE_ROOT, "scripts/browser-audit-vnext.mjs"), "utf8"),
  readFile(path.join(SITE_ROOT, "scripts/install-reviewed-chromium.sh"), "utf8"),
  readFile(path.join(SITE_ROOT, "vnext.js"), "utf8"),
  readFile(path.join(SITE_ROOT, "vnext.css"), "utf8"),
]);
const packageJson = JSON.parse(packageSource);
const packageLock = JSON.parse(packageLockSource);

test("browser gate owns the exact customer navigation and route-only current state", () => {
  assert.deepEqual(PRIMARY_NAV_CONTRACT, [
    { label: "Websites", href: "/websites/", className: "" },
    { label: "Domains", href: "/domains/", className: "" },
    { label: "Services", href: "/solutions/", className: "" },
    { label: "Calls & follow-up", href: "/hive/", className: "" },
    { label: "Examples", href: "/work/", className: "" },
    { label: "About", href: "/about/", className: "" },
    { label: "Get started", href: "/start/", className: "nav-start" },
  ]);
  assert.deepEqual(
    ROUTE_PRIMARY_NAV,
    PRIMARY_NAV_CONTRACT.map(({ label, href }) => ({ label, href })),
    "the browser-owned chrome and canonical route ledger must stay synchronized",
  );
  const entries = (route, visible = true) => PRIMARY_NAV_CONTRACT.map((entry) => ({
    ...entry,
    ariaCurrent: entry.href === route ? "page" : "",
    visible,
  }));
  assert.deepEqual(primaryNavContractFailures(entries("/websites/"), "/websites/"), []);
  assert.deepEqual(
    primaryNavContractFailures(
      entries("/websites/made-for-you/"),
      "/websites/made-for-you/",
    ),
    [],
    "nested routes must not mark a parent navigation destination as current",
  );
  assert.deepEqual(
    primaryNavContractFailures(entries("/contact/"), "/contact/", { visibility: "all" }),
    [],
  );
  const desktop = entries("/faq/");
  assert.deepEqual(
    primaryNavContractFailures(desktop, "/faq/", { visibility: "desktop" }),
    [],
  );
  const wrongOrder = entries("/websites/");
  [wrongOrder[0], wrongOrder[1]] = [wrongOrder[1], wrongOrder[0]];
  assert.ok(
    primaryNavContractFailures(wrongOrder, "/websites/")
      .some((failure) => failure.includes("entry 0 label")),
  );
  const wrongCurrent = entries("/websites/");
  wrongCurrent[0].ariaCurrent = "";
  assert.ok(
    primaryNavContractFailures(wrongCurrent, "/websites/")
      .some((failure) => failure.includes("aria-current")),
  );
  const hiddenDesktopStart = desktop.map((entry) => ({ ...entry }));
  hiddenDesktopStart.at(-1).visible = false;
  assert.ok(
    primaryNavContractFailures(hiddenDesktopStart, "/faq/", { visibility: "desktop" })
      .some((failure) => failure.includes("visibility")),
  );
});

test("Hive browser gate owns exact customer plans, examples, radio choices, and Back history", () => {
  assert.deepEqual(HIVE_CUSTOMER_FIELDS, [
    "human",
    "limit",
    "pause",
    "permission",
    "result",
    "when",
  ]);
  assert.deepEqual(HIVE_FORBIDDEN_PUBLIC_FIELDS, [
    "allowedActions",
    "dataConsentConcern",
    "fallbackHumanHandoff",
    "hardBoundary",
    "killSwitch",
    "problem",
    "trigger",
  ]);
  assert.deepEqual(HIVE_CUSTOMER_EXAMPLES, [
    {
      id: "missed-call",
      label: "Missed-call responder",
      result: "A missed call becomes a clear follow-up for your team, so the reason for calling is less likely to get lost.",
    },
    {
      id: "booking",
      label: "Booking guide",
      result: "A customer gets the right booking questions, then a person or booking tool confirms the details.",
    },
    {
      id: "review-request",
      label: "Review request",
      result: "An eligible customer gets one fair request for honest feedback after the job is complete.",
    },
    {
      id: "after-hours",
      label: "After-hours information",
      result: "A customer gets approved basic information and a clear way to reach a person.",
    },
    {
      id: "follow-up",
      label: "Follow-up",
      result: "A promised next step gets a due time and owner, so it is less likely to be forgotten.",
    },
    {
      id: "getting-paid",
      label: "Getting-paid reminder",
      result: "An overdue invoice gets a clear, respectful reminder and an easy path to ask about a problem.",
    },
  ]);
  assert.match(auditSource, /const HIVE_HISTORY_EXERCISE_EXPRESSION/u);
  assert.match(auditSource, /history\.back\(\)/u);
  assert.match(auditSource, /browserBackToTiming/u);
  assert.match(auditSource, /role"\) === "radiogroup"/u);
  assert.match(auditSource, /JSON\.stringify\(result\.hive\.fallbackExamples\)/u);
  assert.match(auditSource, /JSON\.stringify\(result\.hiveReady\.staticExamples\)/u);
  assert.doesNotMatch(auditSource, /machineFieldsComplete/u);
});

test("Start browser gate owns the complete independent decision and Back tables", () => {
  const menuExerciseStart = auditSource.indexOf("const MENU_EXERCISE_EXPRESSION");
  const startExerciseStart = auditSource.indexOf("const START_EXERCISE_EXPRESSION");
  const startExerciseEnd = auditSource.indexOf("function expectedCanonical", startExerciseStart);
  assert.ok(menuExerciseStart >= 0 && startExerciseStart > menuExerciseStart);
  assert.ok(startExerciseEnd > startExerciseStart);
  assert.equal(
    auditSource.slice(menuExerciseStart, startExerciseStart).includes("data-start-reveal"),
    false,
  );
  assert.equal(
    auditSource.slice(startExerciseStart, startExerciseEnd).includes("data-start-reveal"),
    true,
  );
  assert.deepEqual(
    START_INITIAL_TABLE,
    [
      {
        key: "website",
        label: "A website",
        note: "Make a new site or replace one that already exists.",
      },
      {
        key: "system",
        label: "Calls and follow-up",
        note: "Stop missed calls, bookings, reviews, or payments from slipping.",
      },
      {
        key: "service",
        label: "Other website help",
        note: "Review an existing site, ask about upkeep, or solve one specific problem.",
      },
    ],
  );
  assert.deepEqual(
    START_BRANCH_TABLE.map(({ key, question, options }) => ({
      key,
      question,
      optionKeys: options.map((option) => option.key),
    })),
    [
      {
        key: "website",
        question: "Is this a new website or a replacement?",
        optionKeys: ["website-new", "website-replace"],
      },
      {
        key: "website-new",
        question: "How do you want the new website made?",
        optionKeys: ["custom", "website-self-service"],
      },
      {
        key: "website-self-service",
        question: "Does this one-page option fit?",
        optionKeys: ["abracadabra", "self-service-uncertain"],
      },
      {
        key: "website-replace",
        question: "What must survive or change?",
        optionKeys: ["replace-redirects", "replace-migration", "replace-cutover", "replace-uncertain"],
      },
      {
        key: "system",
        question: "Which handoff keeps falling through?",
        optionKeys: [
          "hive-missed-call",
          "hive-booking",
          "hive-review-request",
          "hive-after-hours",
          "hive-follow-up",
          "hive-getting-paid",
          "commission",
        ],
      },
      {
        key: "service",
        question: "Which supporting job is closest?",
        optionKeys: [
          "assessment",
          "foundations",
          "care",
          "domains",
          "email",
          "commerce",
          "interfaces",
          "studio",
          "network",
        ],
      },
    ],
  );
  assert.deepEqual(
    START_DECISION_TABLE.map(({ key, href }) => [key, href]),
    [
      ["website-custom", "/custom/"],
      ["website-abracadabra", "/abracadabra/"],
      ["website-self-service-uncertain", "/contact/"],
      ["website-replace-redirects", "/custom/"],
      ["website-replace-migration", "/custom/"],
      ["website-replace-cutover", "/custom/"],
      ["website-replace-uncertain", "/contact/"],
      ["system-missed-call", "/hive/#missed-call"],
      ["system-booking", "/hive/#booking"],
      ["system-review-request", "/hive/#review-request"],
      ["system-after-hours", "/hive/#after-hours"],
      ["system-follow-up", "/hive/#follow-up"],
      ["system-getting-paid", "/hive/#getting-paid"],
      ["system-commission", "/contact/"],
      ["service-assessment", "/solutions/#assessment"],
      ["service-foundations", "/solutions/#foundations"],
      ["service-care", "/solutions/#care"],
      ["service-domains", "/solutions/#domains"],
      ["service-email", "/solutions/#email"],
      ["service-commerce", "/solutions/#commerce"],
      ["service-interfaces", "/solutions/#interfaces"],
      ["service-studio", "/solutions/#studio"],
      ["service-network", "/solutions/#network"],
    ],
  );
  assert.equal(
    START_DECISION_TABLE.every((entry) =>
      typeof entry.copy === "string"
      && entry.copy.length > 40
      && !Object.hasOwn(entry, "copyIncludes")
    ),
    true,
  );
  assert.deepEqual(
    START_BACK_TABLE.map(({ key }) => key),
    [
      "website-to-need",
      "new-to-website",
      "self-service-to-new",
      "replacement-to-website",
      "system-to-need",
      "service-to-need",
    ],
  );
  assert.match(auditSource, /for \(const expected of expectedLeaves\)/u);
  assert.match(auditSource, /for \(const backCase of backCases\)/u);
  assert.match(auditSource, /touchFailures: touchFailures\(\)/u);
  assert.match(auditSource, /focusVisibility: focusVisibility\(\)/u);
  assert.match(auditSource, /exactFocus: document\.activeElement === question\(\)/u);
  assert.match(auditSource, /answer\.tagName === "BUTTON"/u);
  assert.match(auditSource, /answer\.getAttribute\("type"\) === "button"/u);
  assert.match(auditSource, /const describeUsableControl = \(control\) =>/u);
  assert.match(auditSource, /const describeRenderedVisibility = \(element\) =>/u);
  assert.match(auditSource, /element\.checkVisibility\(\{/u);
  assert.match(auditSource, /checkOpacity: true/u);
  assert.match(auditSource, /checkVisibilityCSS: true/u);
  assert.match(auditSource, /contentVisibilityAuto: true/u);
  assert.match(auditSource, /element\.getClientRects\(\)\.length/u);
  assert.match(auditSource, /element\.closest\("\[hidden\]"\)/u);
  assert.match(auditSource, /element\.closest\('\[aria-hidden="true"\]'\)/u);
  assert.match(auditSource, /element\.closest\("\[inert\]"\)/u);
  assert.match(auditSource, /control\?\.matches\(":disabled"\)/u);
  assert.match(auditSource, /control\?\.closest\('\[aria-disabled="true"\]'\)/u);
  assert.match(auditSource, /control && control\.tabIndex >= 0/u);
  assert.match(auditSource, /rendering\.pointerEventsEnabled/u);
  assert.match(auditSource, /const rendering = describeRenderedVisibility\(element\)/u);
  assert.match(auditSource, /meaningful: rendering\.effectiveVisible/u);
  assert.match(auditSource, /does not claim\s+\/\/ detection of visual occlusion or clipping/u);
  assert.match(auditSource, /function startInitialControlsPass\(snapshot\)/u);
  assert.match(auditSource, /!startInitialControlsPass\(flow\.initial\)/u);
  assert.match(auditSource, /!startInitialControlsPass\(actual\.afterRestart\.initialControls\)/u);
  assert.match(auditSource, /startInitialControlsPass\(actual\.initialControls\)/u);
  assert.match(auditSource, /!actual\.actionControl\.usable/u);
  assert.match(
    auditSource,
    /actual\.actionControl\.viewportVisiblePixels\s+< Math\.min\(actual\.actionControl\.height, 44\)/u,
  );
  assert.match(auditSource, /!actual\.humanControl\.usable/u);
  assert.match(auditSource, /!actual\.restartControl\.usable/u);
  assert.match(auditSource, /!actual\.backControl\.usable/u);
  assert.match(auditSource, /!state\.answerControls\.every\(\(\{ usable \}\) => usable\)/u);
  assert.match(auditSource, /!state\.backControl\.usable/u);
  assert.match(auditSource, /route === "\/abracadabra\/"/u);
  assert.match(auditSource, /!result\.abracadabraHeroAction\.meaningful/u);
  assert.match(auditSource, /actual\.actionTag !== "A"/u);
  assert.match(auditSource, /actual\.humanHref !== "\/contact\/"/u);
  assert.match(auditSource, /actual\.humanTag !== "A"/u);
  assert.match(auditSource, /actual\.actionText !== expected\.action/u);
  assert.match(auditSource, /actual\.copy !== expected\.copy/u);
  assert.doesNotMatch(auditSource, /copyIncludes/u);
  assert.match(auditSource, /JSON\.stringify\(snapshot\.options\) === JSON\.stringify\(START_INITIAL_TABLE\)/u);
  assert.match(auditSource, /flow\.initial\.questionTabindex !== "-1"/u);
  assert.match(auditSource, /flow\.initial\.resultTabindex !== "-1"/u);
  assert.match(auditSource, /flow\.initial\.resultRole !== "status"/u);
  assert.match(auditSource, /flow\.initial\.resultAriaLive !== "polite"/u);
  assert.match(auditSource, /!flow\.initial\.motionStable/u);
  assert.match(auditSource, /revealState: root\.getAttribute\("data-start-reveal"\)/u);
  assert.match(auditSource, /revealState !== "pending"/u);
  assert.match(auditSource, /actual\.revealState !== "ready"/u);
  assert.match(auditSource, /actual\.afterRestart\.revealState !== "ready"/u);
  assert.match(auditSource, /button\.scrollIntoView\(\{ block: "center", behavior: "auto" \}\)/u);
});

test("Start usable-control gate mutates a live control through every rejected state", () => {
  const startExerciseStart = auditSource.indexOf("const START_EXERCISE_EXPRESSION");
  const startExerciseEnd = auditSource.indexOf("function expectedCanonical", startExerciseStart);
  const startExercise = auditSource.slice(startExerciseStart, startExerciseEnd);
  for (const probe of [
    'mutate("display-none"',
    'mutate("ancestor-display-none"',
    'mutate("visibility-hidden"',
    'mutate("ancestor-visibility-hidden"',
    'mutate("opacity-zero"',
    'mutate("ancestor-opacity-zero"',
    'mutate("hidden-attribute"',
    'mutate("ancestor-hidden-attribute"',
    'mutate("aria-hidden"',
    'mutate("ancestor-aria-hidden"',
    'mutate("aria-disabled"',
    'mutate("ancestor-aria-disabled"',
    'mutate("inert"',
    'mutate("ancestor-inert"',
    'mutate("disabled"',
    'mutate("negative-tabindex"',
    'mutate("pointer-events-none"',
    'mutate("ancestor-pointer-events-none"',
    'mutate("zero-geometry"',
  ]) {
    assert.ok(startExercise.includes(probe), `missing Start usable-control mutation probe: ${probe}`);
  }
  assert.match(startExercise, /const controlGuardProbes = probeUsableControlGuard\(firstPath\)/u);
  assert.match(startExercise, /afterRestore: describeUsableControl\(control\)/u);
  assert.match(auditSource, /controlGuardProbes\.probes\.length !== 19/u);
  assert.match(
    auditSource,
    /controlGuardProbes\.probes\.every\(\(\{ rejected \}\) => rejected\)/u,
  );
});

test("Solutions browser gate follows the current primary assessment anchor", () => {
  const exerciseStart = auditSource.indexOf(
    "const SOLUTIONS_PRIMARY_ANCHOR_EXERCISE_EXPRESSION",
  );
  const exerciseEnd = auditSource.indexOf(
    "const SETTLE_IMAGES_EXPRESSION",
    exerciseStart,
  );
  const exercise = auditSource.slice(exerciseStart, exerciseEnd);
  assert.ok(exerciseStart >= 0 && exerciseEnd > exerciseStart);
  assert.match(exercise, /document\.querySelector\("#assessment"\)/u);
  assert.match(exercise, /\.solution-card-head \.card-kicker/u);
  assert.match(exercise, /\.solution-card-head h2/u);
  assert.match(exercise, /location\.hash = "assessment"/u);
  assert.doesNotMatch(exercise, /#service-shelf|\.anchor-nav/u);
  assert.match(auditSource, /shelf\.hash !== "#assessment"/u);
  assert.match(auditSource, /shelf\.kickerTop < shelf\.obstructionBottom - 1/u);
  assert.match(auditSource, /shelf\.headingTop < shelf\.obstructionBottom - 1/u);
});

test("containment porcelain parser preserves both status columns and permits only one worktree deletion", () => {
  assert.equal(assertExactWorktreeDeletion(" D the-meter.html\n", "the-meter.html"), true);
  assert.equal(assertExactWorktreeDeletion(" D the-meter.html\r\n", "the-meter.html"), true);
  for (const status of [
    "D  the-meter.html\n",
    "R  the-meter.html -> replacement.html\n",
    " D the-meter.html\n D the-moat.html\n",
    " D the-meter.html\n?? stray.html\n",
    " D \"the meter.html\"\n",
    "D the-meter.html\n",
    " D the-meter.html\n\n",
  ]) {
    assert.throws(
      () => assertExactWorktreeDeletion(status, "the-meter.html"),
      /changed bytes outside the exact authorized root file/u,
    );
  }
});

test("browser gate pins one exact reviewed Chromium archive and executable identity", () => {
  assert.deepEqual(REVIEWED_CHROMIUM, {
    version: "Google Chrome for Testing 149.0.7827.55",
    archiveUrl: "https://storage.googleapis.com/chrome-for-testing-public/149.0.7827.55/linux64/chrome-headless-shell-linux64.zip",
    archiveSha256: "410c9407d5de3fea80d9398666be06f2aa09154a3fa7b327dc254e336bb4c4b7",
  });
  for (const value of Object.values(REVIEWED_CHROMIUM)) {
    assert.ok(installerSource.includes(value), `installer must pin ${value}`);
  }
  assert.match(installerSource, /--proto '=https'/u);
  assert.match(installerSource, /test "\$observed_sha256" = "\$archive_sha256"/u);
  assert.match(installerSource, /test "\$\("\$binary" --version\)" = "\$expected_version"/u);
  assert.doesNotMatch(installerSource, /\blatest\b/iu);
});

test("browser CLI gives every route a fresh reviewed target", () => {
  const isolationStart = auditSource.indexOf(
    "async function auditRoutesIndependently",
  );
  const isolationEnd = auditSource.indexOf(
    "if (process.argv[1]",
    isolationStart,
  );
  assert.ok(isolationStart >= 0 && isolationEnd > isolationStart);
  const isolationSource = auditSource.slice(isolationStart, isolationEnd);
  assert.match(isolationSource, /for \(const route of routes\)/u);
  assert.match(isolationSource, /routes: \[route\]/u);
  assert.match(isolationSource, /combined\.errors\.push/u);
  assert.match(isolationSource, /combined\.results\.push/u);
  assert.match(auditSource, /const result = await auditRoutesIndependently\(\{/u);
  assert.match(auditSource, /one fresh reviewed browser target per route/u);
});

test("homepage first-paint gate fails closed before load across exact cold scenarios", () => {
  assert.deepEqual(HOME_FIRST_PAINT_VIEWPORTS, [
    { label: "cold-phone-390", width: 390, height: 844, mobile: true },
    { label: "cold-desktop", width: 1440, height: 1000, mobile: false },
  ]);
  assert.deepEqual(HOME_FIRST_PAINT_CHECKPOINTS, [
    { atMs: 300, label: "early", minimumOpacity: 0.05 },
    { atMs: 1000, label: "complete", minimumOpacity: 0.98 },
  ]);
  assert.deepEqual(HOME_FIRST_PAINT_SCENARIOS, [
    "baseline",
    "hero-image-held",
    "hero-image-blocked",
    "javascript-disabled",
    "forced-early-javascript-failure",
  ]);

  const visibleElement = ({
    href = null,
    text,
    height = 80,
    width = 300,
  }) => ({
    effectiveOpacity: 1,
    height,
    href,
    present: true,
    structurallyVisible: true,
    text,
    viewportVisibleHeight: height,
    viewportVisibleWidth: width,
    width,
  });
  const validSnapshot = (checkpoint, scenario) => ({
    elapsedMs: checkpoint.atMs + 20,
    firstContentfulPaintMs: 250,
    forcedFailureTriggered: scenario === "forced-early-javascript-failure",
    h1: visibleElement({ text: "A clearer website for your small business." }),
    hasJsClass: scenario !== "javascript-disabled",
    heroHeldRequests: scenario === "hero-image-held" ? 1 : 0,
    heroImage: {
      complete: !["hero-image-held"].includes(scenario),
      naturalWidth: ["hero-image-held", "hero-image-blocked"].includes(scenario)
        ? 0
        : 1672,
    },
    heroInterceptedRequests: ["hero-image-held", "hero-image-blocked"].includes(scenario)
      ? 1
      : 0,
    path: "/",
    primaryAction: visibleElement({
      href: "/start/",
      text: "Find the right next step",
      height: 48,
      width: 180,
    }),
  });

  for (const scenario of HOME_FIRST_PAINT_SCENARIOS) {
    for (const checkpoint of HOME_FIRST_PAINT_CHECKPOINTS) {
      assert.deepEqual(
        homeFirstPaintFailures(validSnapshot(checkpoint, scenario), checkpoint, scenario),
        [],
        `${scenario} must accept the exact visible checkpoint`,
      );
    }
  }

  const finalCheckpoint = HOME_FIRST_PAINT_CHECKPOINTS.at(-1);
  const mutate = (callback) => {
    const snapshot = structuredClone(validSnapshot(finalCheckpoint, "baseline"));
    callback(snapshot);
    return homeFirstPaintFailures(snapshot, finalCheckpoint, "baseline");
  };
  assert.ok(mutate((snapshot) => {
    snapshot.h1.effectiveOpacity = 0;
  }).some((failure) => failure.includes("h1 effective opacity")));
  assert.ok(mutate((snapshot) => {
    snapshot.primaryAction.viewportVisibleHeight = 20;
  }).some((failure) => failure.includes("primaryAction is not meaningfully visible vertically")));
  assert.ok(mutate((snapshot) => {
    snapshot.primaryAction.width = 30;
    snapshot.primaryAction.viewportVisibleWidth = 30;
  }).some((failure) => failure.includes("primaryAction width is below 44px")));
  assert.ok(mutate((snapshot) => {
    snapshot.elapsedMs = 2000;
  }).some((failure) => failure.includes("checkpoint elapsed")));
  assert.ok(mutate((snapshot) => {
    snapshot.firstContentfulPaintMs = null;
  }).some((failure) => failure.includes("first contentful paint")));

  const held = validSnapshot(finalCheckpoint, "hero-image-held");
  held.heroInterceptedRequests = 0;
  assert.ok(
    homeFirstPaintFailures(held, finalCheckpoint, "hero-image-held")
      .includes("hero image interception did not run"),
  );
  const disabled = validSnapshot(finalCheckpoint, "javascript-disabled");
  disabled.hasJsClass = true;
  assert.ok(
    homeFirstPaintFailures(disabled, finalCheckpoint, "javascript-disabled")
      .includes("JavaScript-disabled document acquired the js class"),
  );
  const forced = validSnapshot(finalCheckpoint, "forced-early-javascript-failure");
  forced.forcedFailureTriggered = false;
  assert.ok(
    homeFirstPaintFailures(forced, finalCheckpoint, "forced-early-javascript-failure")
      .includes("forced early JavaScript failure did not trigger"),
  );

  const coldInfrastructureStart = auditSource.indexOf("async function navigateToDomContent");
  const coldStart = auditSource.indexOf(
    "async function auditHomeFirstPaint",
    coldInfrastructureStart,
  );
  const coldEnd = auditSource.indexOf("function progressiveFailureSource", coldStart);
  const coldSource = auditSource.slice(coldInfrastructureStart, coldEnd);
  assert.ok(
    coldInfrastructureStart >= 0
    && coldStart > coldInfrastructureStart
    && coldEnd > coldStart,
  );
  assert.match(coldSource, /Page\.lifecycleEvent/u);
  assert.match(coldSource, /event\.loaderId === loaderId/u);
  assert.match(coldSource, /Fetch\.enable/u);
  assert.match(coldSource, /Fetch\.failRequest/u);
  assert.match(coldSource, /heldRequestIds\.add\(event\.requestId\)/u);
  assert.match(coldSource, /Emulation\.setScriptExecutionDisabled/u);
  assert.match(coldSource, /Page\.addScriptToEvaluateOnNewDocument/u);
  assert.match(coldSource, /homeFirstPaintExpression\(checkpoint, \{/u);
  assert.match(coldSource, /const pageScriptDisabled = scenario === "javascript-disabled"/u);
  assert.match(
    coldSource,
    /await delay\(Math\.max\(0, checkpoint\.atMs - previousCheckpointAtMs\)\)/u,
  );
  assert.match(coldSource, /asyncWait: !pageScriptDisabled/u);
  assert.match(coldSource, /awaitPromise: !pageScriptDisabled/u);
  assert.match(coldSource, /Network\.clearBrowserCache/u);
  const coldAuditSource = auditSource.slice(coldStart, coldEnd);
  const rendererWarmup = coldAuditSource.indexOf(
    'const warmed = await cdp.send("Runtime.evaluate"',
  );
  const measuredScenarios = coldAuditSource.indexOf(
    "for (const scenario of HOME_FIRST_PAINT_SCENARIOS)",
  );
  const measuredCacheClear = coldAuditSource.indexOf(
    'await cdp.send("Network.clearBrowserCache")',
  );
  assert.ok(
    rendererWarmup >= 0
    && measuredScenarios > rendererWarmup
    && measuredCacheClear > measuredScenarios,
    "renderer/compositor warm-up must precede measured scenarios while every scenario stays cache-cold",
  );
  assert.match(
    coldAuditSource,
    /requestAnimationFrame\(\(\) => requestAnimationFrame\(resolve\)\)/u,
  );
  const coldInvocation = auditSource.indexOf("await auditHomeFirstPaint(cdp, auditOrigin)");
  const ordinaryRuntimeErrors = auditSource.indexOf("const runtimeErrors = []", coldInvocation);
  assert.ok(coldInvocation >= 0 && ordinaryRuntimeErrors > coldInvocation);
});

test("progressive-failure gate keeps every canonical route usable at bounded initializer failures", () => {
  assert.deepEqual(PROGRESSIVE_FAILURE_VIEWPORT, {
    label: "phone-390-progressive-failure",
    width: 390,
    height: 844,
    mobile: true,
  });
  assert.deepEqual(PROGRESSIVE_FAILURE_SCENARIOS, [
    {
      key: "after-root-js",
      failureStage: "root-js-class",
      menuReady: false,
      revealReady: false,
    },
    {
      key: "during-menu-initializer",
      failureStage: "menu-listener",
      menuReady: false,
      revealReady: false,
    },
    {
      key: "during-reveal-initializer",
      failureStage: "reveal-query",
      menuReady: true,
      revealReady: false,
    },
  ]);
  assert.deepEqual(PROGRESSIVE_REVEAL_ROUTES, [
    "/",
    "/custom/",
    "/custom/scope/",
    "/custom/process/",
    "/abracadabra/",
    "/abracadabra/how/",
    "/hive/",
    "/solutions/",
    "/about/",
    "/start/",
  ]);
  assert.deepEqual(PROGRESSIVE_DISCLOSURE_COUNTS, {
    "/custom/scope/": 4,
    "/custom/process/": 3,
    "/abracadabra/how/": 7,
    "/about/": 1,
    "/contact/": 2,
    "/faq/": 13,
    "/solutions/": 9,
    "/legal/": 1,
    "/legal/privacy/": 16,
    "/legal/website-terms/": 17,
  });
  assert.equal(CANONICAL_ROUTES.length, 20);

  const validSnapshot = (scenario) => ({
    belowFold: {
      initiallyBelowFold: true,
      present: true,
      textLength: 400,
      usable: true,
    },
    disclosures: { count: 9, failures: [] },
    essential: { count: 12, failures: [] },
    failure: {
      jsAtFailure: true,
      scenario: scenario.key,
      stage: scenario.failureStage,
    },
    h1: { count: 1, text: "One exact piece, handled properly.", usable: true },
    hasJsClass: true,
    menuReady: scenario.menuReady,
    nav: {
      entries: PRIMARY_NAV_CONTRACT.map((entry) => ({
        ...entry,
        ariaCurrent: scenario.key !== "after-root-js" && entry.href === "/solutions/"
          ? "page"
          : "",
      })),
      failures: [],
      mode: scenario.menuReady ? "enhanced-disclosure" : "fallback-links",
      usable: true,
    },
    path: "/solutions/",
    readyState: "complete",
    revealReady: scenario.revealReady,
    reveals: { belowFoldCount: 8, count: 14, failures: [] },
  });
  for (const scenario of PROGRESSIVE_FAILURE_SCENARIOS) {
    assert.deepEqual(
      progressiveFailureFailures(validSnapshot(scenario), scenario.key, "/solutions/"),
      [],
      scenario.key,
    );
  }

  const scenario = PROGRESSIVE_FAILURE_SCENARIOS[0];
  const mutate = (callback) => {
    const snapshot = structuredClone(validSnapshot(scenario));
    callback(snapshot);
    return progressiveFailureFailures(snapshot, scenario.key, "/solutions/");
  };
  assert.ok(mutate((snapshot) => {
    snapshot.failure.jsAtFailure = false;
  }).some((failure) => failure.includes("forced failure marker")));
  assert.ok(mutate((snapshot) => {
    snapshot.menuReady = true;
  }).some((failure) => failure.includes("menu-ready")));
  assert.ok(mutate((snapshot) => {
    snapshot.h1.usable = false;
  }).some((failure) => failure.includes("route H1")));
  assert.ok(mutate((snapshot) => {
    snapshot.nav.usable = false;
  }).some((failure) => failure.includes("primary navigation")));
  assert.ok(mutate((snapshot) => {
    snapshot.essential.failures.push({ label: "hidden action" });
  }).some((failure) => failure.includes("essential links/actions")));
  assert.ok(mutate((snapshot) => {
    snapshot.disclosures.count = 8;
  }).some((failure) => failure.includes("native disclosures")));
  assert.ok(mutate((snapshot) => {
    snapshot.reveals.failures.push({ label: "hidden reveal" });
  }).some((failure) => failure.includes("reveal content")));
  assert.ok(mutate((snapshot) => {
    snapshot.belowFold.usable = false;
  }).some((failure) => failure.includes("below-fold route content")));

  const progressiveStart = auditSource.indexOf("function progressiveFailureSource");
  const progressiveEnd = auditSource.indexOf("const AUDIT_EXPRESSION", progressiveStart);
  const progressiveSource = auditSource.slice(progressiveStart, progressiveEnd);
  assert.ok(progressiveStart >= 0 && progressiveEnd > progressiveStart);
  assert.match(progressiveSource, /DOMTokenList\.prototype\.add/u);
  assert.match(progressiveSource, /this\.hasAttribute\("data-menu"\)/u);
  assert.match(progressiveSource, /selector !== "\.reveal"/u);
  assert.match(
    progressiveSource,
    /jsAtFailure: document\.documentElement\.classList\.contains\("js"\)/u,
  );
  assert.match(progressiveSource, /for \(const route of routes\)/u);
  assert.match(progressiveSource, /for \(const scenario of PROGRESSIVE_FAILURE_SCENARIOS\)/u);
  assert.match(progressiveSource, /main\.querySelectorAll\(controlSelector\)/u);
  assert.match(progressiveSource, /main\.querySelectorAll\("details"\)/u);
  assert.match(progressiveSource, /document\.querySelectorAll\("\.reveal"\)/u);
  assert.match(
    progressiveSource,
    /main\.querySelectorAll\("section, article, h2, h3, p, li"\)/u,
  );
  assert.match(
    progressiveSource,
    /root\.style\.setProperty\("scroll-behavior", "auto", "important"\)/u,
  );
  assert.match(
    progressiveSource,
    /root\.style\.removeProperty\("scroll-behavior"\)/u,
  );
  assert.match(progressiveSource, /Page\.addScriptToEvaluateOnNewDocument/u);
  assert.match(progressiveSource, /Page\.removeScriptToEvaluateOnNewDocument/u);
  const progressiveInvocation = auditSource.indexOf(
    "await auditProgressiveEnhancementFailures(cdp, auditOrigin, routes)",
  );
  const ordinaryRuntimeErrors = auditSource.indexOf(
    "const runtimeErrors = []",
    progressiveInvocation,
  );
  assert.ok(progressiveInvocation >= 0 && ordinaryRuntimeErrors > progressiveInvocation);

  const menuStart = vnextScriptSource.indexOf("function setupMenu()");
  const menuEnd = vnextScriptSource.indexOf("function watchHeader()", menuStart);
  const menuSource = vnextScriptSource.slice(menuStart, menuEnd);
  assert.ok(menuStart >= 0 && menuEnd > menuStart);
  assert.ok(
    vnextScriptSource.indexOf('root.classList.add("js")') >= 0
    && vnextScriptSource.indexOf('root.classList.add("js")') < menuStart,
  );
  assert.ok(
    menuSource.indexOf('menu.addEventListener("click"')
    < menuSource.indexOf('root.classList.add("menu-ready")'),
  );
  const revealStart = vnextScriptSource.indexOf("function revealSections()");
  const revealEnd = vnextScriptSource.indexOf("function setupStartChooser()", revealStart);
  const revealSource = vnextScriptSource.slice(revealStart, revealEnd);
  assert.ok(revealStart >= 0 && revealEnd > revealStart);
  assert.equal(revealSource.match(/root\.classList\.add\("reveal-ready"\)/gu)?.length, 2);
  assert.ok(
    revealSource.indexOf("observer.observe(item)")
    < revealSource.lastIndexOf('root.classList.add("reveal-ready")'),
  );
  assert.ok(
    vnextScriptSource.lastIndexOf("\n  setupMenu();")
    < vnextScriptSource.lastIndexOf("\n  revealSections();"),
  );
  assert.match(vnextStyleSource, /\.reveal-ready \.reveal \{/u);
  assert.match(vnextStyleSource, /\.menu-ready \.site-header:has\(\.menu-button\) \.site-nav \{/u);
  assert.doesNotMatch(vnextStyleSource, /(?:^|\n)\.js \.reveal \{/u);
  assert.doesNotMatch(
    vnextStyleSource,
    /\.reveal-ready \.reveal(?:\[data-revealed="true"\])? \{[^}]*\btransform\s*:/su,
    "decorative reveal motion must not move interactive hit geometry while a customer taps",
  );
  assert.doesNotMatch(vnextStyleSource, /\.js \.site-header:has\(\.menu-button\)/u);
});

test("Abracadabra browser gate enforces held versus hosted control boundaries", () => {
  assert.match(auditSource, /configuredControlMode/u);
  assert.match(auditSource, /controlModeMeta/u);
  assert.match(auditSource, /hostedControlScriptPresent/u);
  assert.match(auditSource, /accountControlCount/u);
  assert.match(auditSource, /publishControlCount/u);
  assert.match(auditSource, /const heldSource = result\.sparkReady\.configuredControlMode === "hold"/u);
  assert.match(auditSource, /const hostedArtifact = result\.sparkReady\.configuredControlMode === "hosted"/u);
  assert.match(auditSource, /result\.sparkReady\.controlRoomPresent/u);
  assert.match(auditSource, /abracadabraControlMode === "local-rehearsal"/u);
  assert.match(auditSource, /controlReady: controlRoom\?\.getAttribute\("data-control-ready"\)/u);
  assert.match(auditSource, /result\.sparkReady\.controlReady !== "hosted"/u);
  assert.match(auditSource, /result\.sparkReady\.documentControlReady !== "hosted"/u);
  assert.match(auditSource, /guestFlow\.providerHold\.buttonEnabled/u);
  assert.match(auditSource, /guestFlow\.providerHold\.previewStillVisible/u);
  assert.match(auditSource, /held-provider retry path failed/u);
  assert.match(auditSource, /Runtime\.exceptionThrown/u);
  assert.match(auditSource, /hosted artifact audit intentionally runs without an API service/u);
  assert.match(auditSource, /correct\.sandbox !== "allow-popups"/u);
  assert.match(auditSource, /compiler\.compileSite\(rawFacts\)/u);
  assert.match(auditSource, /Input\.dispatchMouseEvent/u);
  assert.match(auditSource, /Page\.windowOpen/u);
  assert.match(auditSource, /Target\.targetCreated/u);
  assert.match(auditSource, /Target\.closeTarget/u);
  assert.match(auditSource, /Target\.attachToTarget/u);
  assert.match(auditSource, /Target\.detachFromTarget/u);
  assert.match(auditSource, /PRIVATE_VIEWER_POPUP_TIMEOUT_MS/u);
  assert.match(auditSource, /--host-resolver-rules=MAP cta\.invalid ~NOTFOUND/u);
  assert.match(auditSource, /PRIVATE_VIEWER_STALE_GRACE_EXPRESSION/u);
  assert.match(auditSource, /PRIVATE_VIEWER_PLATFORM_MISSING_EXPRESSION/u);
  assert.match(auditSource, /missing lifecycle platform exposed stale grace bytes/u);
});

test("Abracadabra popup inspection waits only for the asynchronous srcdoc attachment", async () => {
  let clock = 0;
  let attempts = 0;
  const attachment = await waitForPrivateViewerAttachment(
    async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("published-site contentDocument was not attached");
      }
      if (attempts === 2) {
        throw new Error("exact compiled external CTA count was 0");
      }
      return { backendNodeId: 202 };
    },
    {
      now: () => clock,
      pollMs: 25,
      timeoutMs: 100,
      wait: async (milliseconds) => {
        clock += milliseconds;
      },
    },
  );
  assert.deepEqual(attachment, { backendNodeId: 202 });
  assert.equal(attempts, 3);
  assert.equal(clock, 50);

  await assert.rejects(
    waitForPrivateViewerAttachment(
      async () => {
        throw new Error("published-site owner count was 0");
      },
      {
        now: () => clock,
        wait: async () => {
          throw new Error("non-attachment failures must not be retried");
        },
      },
    ),
    /published-site owner count was 0/u,
  );

  const popupStart = auditSource.indexOf("async function exercisePrivateViewerPopup");
  const popupEnd = auditSource.indexOf(
    "const ABRACADABRA_REDUCED_MOTION_TRANSITION_EXPRESSION",
    popupStart,
  );
  const popupSource = auditSource.slice(popupStart, popupEnd);
  assert.ok(popupStart >= 0 && popupEnd > popupStart);
  assert.equal(
    popupSource.match(/await waitForPrivateViewerAttachment\(/gu)?.length,
    3,
  );
  assert.match(
    popupSource,
    /target\.type === "iframe"\s*&& target\.url === "about:srcdoc"/u,
  );
  assert.match(
    popupSource,
    /"Target\.attachToTarget",\s*\{\s*flatten: true,/u,
  );
  assert.match(
    popupSource,
    /"Input\.dispatchMouseEvent", \{[\s\S]*?\}, 3000, attachment\.domSessionId\)/u,
  );
  assert.match(
    popupSource,
    /"Target\.detachFromTarget",\s*\{ sessionId: attachedFrameSessionId \}/u,
  );
});

test("Abracadabra missing-platform interception bypasses and clears prior script cache", () => {
  const staleStart = auditSource.indexOf("let platformRequests = 0");
  const staleEnd = auditSource.indexOf(
    "PRIVATE_VIEWER_CLEANUP_EXPRESSION",
    staleStart,
  );
  const staleSource = auditSource.slice(staleStart, staleEnd);
  assert.ok(staleStart >= 0 && staleEnd > staleStart);

  const networkEnableAt = staleSource.indexOf('cdp.send("Network.enable")');
  const cacheDisableAt = staleSource.indexOf(
    'cdp.send("Network.setCacheDisabled", { cacheDisabled: true })',
  );
  const cacheClearAt = staleSource.indexOf('cdp.send("Network.clearBrowserCache")');
  const fetchEnableAt = staleSource.indexOf('cdp.send("Fetch.enable"');
  const navigateAt = staleSource.indexOf("await navigate(cdp, viewerUrl)");
  const fetchDisableAt = staleSource.indexOf('cdp.send("Fetch.disable")', navigateAt);
  const cacheRestoreAt = staleSource.indexOf(
    'cdp.send("Network.setCacheDisabled", { cacheDisabled: false })',
    navigateAt,
  );
  const networkDisableAt = staleSource.indexOf('cdp.send("Network.disable")', navigateAt);

  assert.ok(networkEnableAt >= 0);
  assert.ok(networkEnableAt < cacheDisableAt);
  assert.ok(cacheDisableAt < cacheClearAt);
  assert.ok(cacheClearAt < fetchEnableAt);
  assert.ok(fetchEnableAt < navigateAt);
  assert.ok(navigateAt < fetchDisableAt);
  assert.ok(fetchDisableAt < cacheRestoreAt);
  assert.ok(cacheRestoreAt < networkDisableAt);
});

test("Abracadabra popup proof fails closed and requires target cleanup", () => {
  const expectedUrl = "https://cta.invalid/abracadabra-popup-proof";
  const complete = {
    cleanup: {
      attemptedTargetIds: ["popup-target"],
      closeErrors: [],
      discoveryDisabled: true,
      domDisabled: true,
      frameSessionDetached: true,
      listenersRemoved: true,
      remainingTargetIds: [],
    },
    click: {
      backendNodeId: 202,
      href: expectedUrl,
      interaction: "Input.dispatchMouseEvent",
      rel: "noopener noreferrer",
      target: "_blank",
    },
    error: "",
    frame: {
      contentDocumentBackendNodeId: 201,
      frameId: "published-frame",
      inspection: "DOM.getDocument(pierce)",
      ownerBackendNodeId: 200,
      sandbox: "allow-popups",
      sandboxRestrictsOriginAndScripts: true,
    },
    innerAfter: {
      backendNodeId: 202,
      documentConnected: true,
      href: expectedUrl,
      linkConnected: true,
      target: "_blank",
    },
    outerAfter: {
      frameConnected: true,
      sandbox: "allow-popups",
      siteHidden: false,
      sourceRetained: true,
      state: "live",
    },
    popup: {
      createdEvent: true,
      openerFrameId: "published-frame",
      targetId: "popup-target",
      type: "page",
      url: expectedUrl,
    },
    windowOpen: {
      url: expectedUrl,
      userGesture: true,
    },
  };
  assert.deepEqual(privateViewerPopupFailures(complete), []);

  const unsafeSandbox = structuredClone(complete);
  unsafeSandbox.frame.sandbox = "allow-popups allow-same-origin";
  assert.match(
    privateViewerPopupFailures(unsafeSandbox).join("\n"),
    /source frame sandbox/u,
  );

  const noCreatedTarget = structuredClone(complete);
  noCreatedTarget.popup.createdEvent = false;
  assert.match(
    privateViewerPopupFailures(noCreatedTarget).join("\n"),
    /Target\.targetCreated proof/u,
  );

  const untrustedOpen = structuredClone(complete);
  untrustedOpen.windowOpen.userGesture = false;
  assert.match(
    privateViewerPopupFailures(untrustedOpen).join("\n"),
    /Page\.windowOpen proof/u,
  );

  const strandedPopup = structuredClone(complete);
  strandedPopup.cleanup.remainingTargetIds = ["popup-target"];
  assert.match(
    privateViewerPopupFailures(strandedPopup).join("\n"),
    /popup cleanup is incomplete/u,
  );
});

test("npm test builds and verifies the exact artifact before the mandatory browser gate", () => {
  assert.equal(
    packageJson.scripts["audit:browser"],
    "node --experimental-websocket scripts/browser-audit-current.mjs",
  );
  assert.equal(
    packageJson.scripts["audit:hosted-domain-browser:legacy"],
    "node --experimental-websocket scripts/browser-hosted-domain-journey.mjs",
  );
  const sequence = packageJson.scripts.test.split(" && ");
  assert.deepEqual(sequence.slice(-4), [
    "npm run build:pages",
    "npm run check:artifact",
    "npm run check:hosted",
    "npm run audit:browser",
  ]);
  assert.match(auditSource, /const DEFAULT_ARTIFACT_ROOT = path\.join\(SITE_ROOT, "_site"\)/u);
  assert.match(
    auditSource,
    /const artifactServer = origin \? null : await startArtifactServer\(absoluteArtifactRoot\)/u,
  );
  assert.match(auditSource, /SITESOURCERY_ARTIFACT_ROOT/u);
  assert.doesNotMatch(auditSource, /origin = "http:\/\/127\.0\.0\.1:4173"/u);
});

test("test commands are executable by the exact pinned Node runtime", () => {
  const pinnedNode = pinnedNodeSource.trim();
  assert.equal(pinnedNode, "24.18.0");
  assert.equal(packageJson.engines.node, pinnedNode);
  assert.equal(packageLock.packages[""].engines.node, pinnedNode);
  for (const scriptName of [
    "test:node",
    "test:public-truth:legacy",
    "test:public-truth:v2",
  ]) {
    const command = packageJson.scripts[scriptName];
    assert.match(
      command,
      /^node (?:--experimental-websocket )?--test /u,
      `${scriptName} must use the built-in test runner`,
    );
    assert.doesNotMatch(
      command,
      /--test-isolation(?:=|\s)/u,
      `${scriptName} must not use the Node 22-only --test-isolation flag`,
    );
  }
});

test("artifact-only audit server resolves canonical files and rejects path traversal", () => {
  assert.equal(artifactPath("/"), path.join(SITE_ROOT, "_site/index.html"));
  assert.equal(artifactPath("/custom/scope/"), path.join(SITE_ROOT, "_site/custom/scope/index.html"));
  assert.equal(artifactPath("/vnext.css"), path.join(SITE_ROOT, "_site/vnext.css"));
  assert.equal(artifactPath("/../package.json"), null);
  assert.equal(artifactPath("/%2e%2e/package.json"), null);
  assert.equal(artifactPath("/custom/../../package.json"), null);
  assert.equal(artifactPath("/%00"), null);
  assert.equal(
    artifactPath("/index.html", "/tmp/exact-external-artifact"),
    "/tmp/exact-external-artifact/index.html",
  );
  assert.equal(artifactPath("/../package.json", "/tmp/exact-external-artifact"), null);
});

test("every release or quality workflow installs the exact browser before npm test", async () => {
  for (const file of WORKFLOWS) {
    const source = await readFile(path.join(SITE_ROOT, file), "utf8");
    const installAt = source.indexOf(INSTALL_COMMAND);
    const testAt = file.endsWith("containment.yml")
      ? source.indexOf("run: node control/scripts/audit-artifact-from-sitemap.mjs baseline/_site")
      : source.indexOf("run: npm test");
    assert.ok(installAt >= 0, `${file} must install the reviewed browser`);
    assert.equal(source.indexOf(INSTALL_COMMAND, installAt + 1), -1, `${file} must install it once`);
    assert.ok(testAt > installAt, `${file} must install the browser before npm test`);
    assert.doesNotMatch(source, /continue-on-error:\s*true/iu, `${file} must fail closed`);
    for (const packagingMarker of [
      "actions/upload-pages-artifact@",
      "actions/upload-artifact@",
      "npm run build:pages",
    ]) {
      const packageAt = source.indexOf(packagingMarker, testAt);
      if (packageAt >= 0) {
        assert.ok(packageAt > testAt, `${file} must run npm test before ${packagingMarker}`);
      }
    }
  }
});

test("cross-revision workflows use current control tooling for historical artifacts", async () => {
  const [containment, reconciliation] = await Promise.all([
    readFile(path.join(SITE_ROOT, ".github/workflows/containment.yml"), "utf8"),
    readFile(path.join(SITE_ROOT, ".github/workflows/public-truth-reconciliation.yml"), "utf8"),
  ]);
  assert.match(
    containment,
    /working-directory: control\s+run: bash scripts\/install-reviewed-chromium\.sh/u,
  );
  assert.match(
    reconciliation,
    /working-directory: control\s+run: bash scripts\/install-reviewed-chromium\.sh/u,
  );
  assert.match(containment, /node control\/scripts\/build-contained-artifact\.mjs/u);
  assert.match(containment, new RegExp(CONTROL_AUDIT_COMMAND.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.match(reconciliation, new RegExp(CONTROL_AUDIT_COMMAND.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.doesNotMatch(containment, /working-directory: target\s+run: bash scripts\/install-reviewed-chromium\.sh/u);
  assert.doesNotMatch(reconciliation, /working-directory: target\s+run: bash scripts\/install-reviewed-chromium\.sh/u);
  assert.doesNotMatch(containment, /npm run build:pages/u);
  assert.match(containment, /path: baseline/u);
  assert.match(containment, /working-directory: target\s+run: npm run check:html/u);
  const baselineBuildCommandAt = containment.indexOf(
    "node control/scripts/build-contained-artifact.mjs",
  );
  const baselineRootAt = containment.indexOf("baseline \\", baselineBuildCommandAt);
  const baselineShaAt = containment.indexOf('"$PRODUCTION_SHA" \\', baselineRootAt);
  const baselineFlagAt = containment.indexOf("--baseline \\", baselineShaAt);
  const baselineOutputAt = containment.indexOf("baseline/_site", baselineFlagAt);
  assert.ok(
    baselineBuildCommandAt >= 0
    && baselineRootAt > baselineBuildCommandAt
    && baselineShaAt > baselineRootAt
    && baselineFlagAt > baselineShaAt
    && baselineOutputAt > baselineFlagAt,
  );
  assert.match(
    containment,
    /node control\/scripts\/audit-artifact-from-sitemap\.mjs baseline\/_site/u,
  );
  assert.doesNotMatch(containment, /working-directory: target\s+run: npm test/u);
  const baselineAt = containment.indexOf("Audit untouched baseline public projection with current controls");
  const prepareAt = containment.indexOf("Prepare one-path removal from the production tree");
  const buildAt = containment.indexOf("Build the contained predecessor exactly once with current controls");
  const auditAt = containment.indexOf("Audit the exact contained artifact with current controls");
  const packageAt = containment.indexOf("Package exact containment artifact");
  assert.ok(baselineAt >= 0 && baselineAt < prepareAt);
  assert.ok(prepareAt < buildAt && buildAt < auditAt && auditAt < packageAt);
  assert.doesNotMatch(containment.slice(prepareAt, buildAt), /run: npm test/u);
  assert.match(containment, /target\/_site "\/\$REMOVE_PATH"/u);
  assert.match(containment, /path: target\/_site/u);
});

test("the actual production predecessor executes one exact root-file containment", async () => {
  function gitObjectExists(commit, file) {
    const result = spawnSync("git", ["cat-file", "-e", `${commit}:${file}`], {
      cwd: SITE_ROOT,
      encoding: "utf8",
    });
    return result.status === 0;
  }
  assert.equal(gitObjectExists(PRODUCTION_PREDECESSOR_SHA, "scripts/build-pages.mjs"), false);
  assert.equal(gitObjectExists(PRODUCTION_PREDECESSOR_SHA, "scripts/install-reviewed-chromium.sh"), false);
  assert.equal(gitObjectExists(CANDIDATE_BASE_SHA, "scripts/install-reviewed-chromium.sh"), false);
  assert.equal(gitObjectExists(CANDIDATE_BASE_SHA, "scripts/browser-audit-vnext.mjs"), false);

  const baselineScratch = await mkdtemp(path.join(tmpdir(), "sitesourcery-predecessor-base-"));
  const containedScratch = await mkdtemp(path.join(tmpdir(), "sitesourcery-predecessor-contained-"));
  try {
    for (const scratch of [baselineScratch, containedScratch]) {
      const cloned = spawnSync("git", ["clone", "--quiet", "--no-checkout", "--shared", SITE_ROOT, scratch], {
        encoding: "utf8",
      });
      assert.equal(cloned.status, 0, cloned.stderr);
    }
    const baselineOutput = path.join(baselineScratch, "_site");
    const baseline = buildContainedArtifact({
      output: baselineOutput,
      productionSha: PRODUCTION_PREDECESSOR_SHA,
      repositoryRoot: baselineScratch,
    });

    const checkedOut = spawnSync(
      "git",
      ["checkout", "--quiet", "--detach", PRODUCTION_PREDECESSOR_SHA],
      { cwd: containedScratch, encoding: "utf8" },
    );
    assert.equal(checkedOut.status, 0, checkedOut.stderr);
    const prepared = prepareContainment(
      containedScratch,
      PRODUCTION_PREDECESSOR_SHA,
      "the-meter.html",
    );
    assert.equal(prepared.removePath, "the-meter.html");
    assert.equal(prepared.targetRoot, containedScratch);

    const containedOutput = path.join(containedScratch, "_site");
    const contained = buildContainedArtifact({
      output: containedOutput,
      productionSha: PRODUCTION_PREDECESSOR_SHA,
      removePath: "the-meter.html",
      repositoryRoot: containedScratch,
    });
    assert.deepEqual(contained.removed, ["the-meter.html"]);
    assert.deepEqual(
      contained.files,
      baseline.files.filter((file) => file !== "the-meter.html"),
    );
    await assert.rejects(lstat(path.join(containedOutput, "the-meter.html")), { code: "ENOENT" });
    for (const file of contained.files) {
      assert.deepEqual(
        await readFile(path.join(containedOutput, file)),
        await readFile(path.join(baselineOutput, file)),
        `${file} must remain byte-identical`,
      );
    }
    assert.equal(contained.files.includes("package.json"), false);
    assert.equal(contained.files.includes("flyer.html"), false);
    assert.equal(contained.files.some((file) => file.startsWith("scripts/")), false);
    assert.equal(contained.files.some((file) => file.startsWith("print-collateral/")), false);
    const graph = await verifyArtifactLinkGraph(containedOutput, "/the-meter.html");
    assert.ok(graph.checkedReferences > 0);
    assert.deepEqual(await routesFromArtifactSitemap(containedOutput), [
      "/",
      "/pricing.html",
      "/automation.html",
      "/how-it-works.html",
      "/about.html",
      "/faq.html",
      "/terms.html",
      "/privacy.html",
      "/contact.html",
      "/start/",
    ]);
  } finally {
    await rm(baselineScratch, { recursive: true, force: true });
    await rm(containedScratch, { recursive: true, force: true });
  }
});
