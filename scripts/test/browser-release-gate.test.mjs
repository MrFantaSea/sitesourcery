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
  REVIEWED_CHROMIUM,
  START_BACK_TABLE,
  START_BRANCH_TABLE,
  START_DECISION_TABLE,
  START_INITIAL_TABLE,
} from "../browser-audit-vnext.mjs";
import { buildContainedArtifact } from "../build-contained-artifact.mjs";
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

const [packageSource, auditSource, installerSource] = await Promise.all([
  readFile(path.join(SITE_ROOT, "package.json"), "utf8"),
  readFile(path.join(SITE_ROOT, "scripts/browser-audit-vnext.mjs"), "utf8"),
  readFile(path.join(SITE_ROOT, "scripts/install-reviewed-chromium.sh"), "utf8"),
]);
const packageJson = JSON.parse(packageSource);

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
        note: "Make a new site or safely replace an existing one.",
      },
      {
        key: "system",
        label: "A working system",
        note: "Stop a repetitive handoff from falling through.",
      },
      {
        key: "service",
        label: "A supporting service",
        note: "Assessment, domains, email, care, commerce, interfaces, studio work, or connections.",
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
        question: "Does the exact self-service boundary fit?",
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
  assert.match(auditSource, /actual\.humanHref !== "#direct-contact"/u);
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

test("npm test builds and verifies the exact artifact before the mandatory browser gate", () => {
  assert.equal(packageJson.scripts["audit:browser"], "node scripts/browser-audit-vnext.mjs");
  const sequence = packageJson.scripts.test.split(" && ");
  assert.deepEqual(sequence.slice(-3), [
    "npm run build:pages",
    "npm run check:artifact",
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
