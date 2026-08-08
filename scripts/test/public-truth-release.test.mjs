import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  AUTHORITY_STATEMENT,
  CARD_V9_PDF_SHA256,
  CANDIDATE_BASE_SHA,
  CANDIDATE_CHANGED_PATHS,
  CONTROL_CHANGED_PATHS,
  EXCLUDED_ARTIFACT_TOP_LEVEL,
  FROZEN_BASE_BLOBS,
  MAX_AUTHORITY_LIFETIME_MS,
  MIN_PREDEPLOY_AUTHORITY_REMAINING_MS,
  OG_PNG_SHA256,
  OG_SOURCE_SHA256,
  POSTDEPLOY_EVIDENCE_RETENTION_DAYS,
  POSTDEPLOY_POLL_INTERVAL_MS,
  POSTDEPLOY_PROPAGATION_WINDOW_MS,
  POSTDEPLOY_REQUEST_CONCURRENCY,
  POSTDEPLOY_REQUEST_TIMEOUT_MS,
  POSTDEPLOY_REQUIRED_EXACT_SNAPSHOTS,
  PRODUCTION_PREDECESSOR_SHA,
  PRODUCTION_CANONICAL_ROUTE_FILES,
  PRODUCTION_LEGACY_REDIRECTS,
  PRODUCTION_ORIGIN,
  PUBLIC_PROJECTION_DIGEST,
  PublicTruthVerificationError,
  RECEIPT_PATH,
  RECEIPT_SCHEMA,
  RELEASE_ENVIRONMENT,
  REPOSITORY_FULL_NAME,
  REVIEWED_DOMAIN_PREFLIGHT_SHA256,
  REVIEWED_PUBLIC_ARTIFACT_PATHS,
  SOURCE_CATALOG_DIGEST,
  SOURCE_ONLY_LEGACY_REDIRECT,
  artifactPublicPath,
  artifactManifest,
  computeReleaseEpochSha256,
  forbiddenPublicMarkers,
  gitDiffPaths,
  inspectLiveProductionSnapshot,
  normalizeLiveOrigin,
  parseCli,
  parseStrictJson,
  pollLiveProduction,
  resolveAuthorityReceiptPath,
  runCli,
  sha256,
  sourceManifestFromGit,
  stableStringify,
  validateArtifactSafety,
  validateArtifactManifestShape,
  validateCandidateControl,
  validateEnabledControl,
  validatePagesObservation,
  validatePagesDeploymentObservation,
  validatePostdeployIdentity,
  validatePredeployState,
  validateProductionRouteManifest,
  validatePublicTruthTextSet,
  validateReceipt,
  validateReviewedOgAssets,
  validateRuntimeAuthorityEnvironment,
  verifyProductionRouteContract,
} from "../verify-public-truth-release.mjs";
import { publicFileAllowlist } from "../build-pages.mjs";

const PROJECT_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const CANDIDATE_SHA = "0123456789abcdef0123456789abcdef01234567";
const SOURCE_MANIFEST_SHA = "ab".repeat(32);
const ARTIFACT_MANIFEST_SHA = "cd".repeat(32);
const RECEIPT_SHA = "ef".repeat(32);
const NOW = Date.parse("2026-07-25T12:15:00.000Z");
const LEGACY_SOURCE_ONLY_ARTIFACT_PATHS = Object.freeze([
  "abracadabra/app/abracadabra-account.js",
  "abracadabra/app/abracadabra-paid-download.js",
  "abracadabra/platform/abracadabra-platform.js",
  "abracadabra/site/index.html",
  "abracadabra/site/viewer.css",
  "abracadabra/site/viewer.js",
  "assets/portfolio-daarx-v3.webp",
  "atelier-commerce.css",
  "atelier-commerce.js",
  "atelier-inner.css",
  "atelier-story.css",
  "atelier-story.js",
  "atelier-utility.css",
  "atelier-utility.js",
  "sourcery.js",
  "style.css",
  "thanks.html",
]);
const [CURRENT_WORKFLOW_TEXT, CURRENT_OG_SOURCE_TEXT] = await Promise.all([
  readFile(path.join(PROJECT_ROOT, ".github/workflows/public-truth-reconciliation.yml"), "utf8"),
  readFile(path.join(PROJECT_ROOT, "scripts/assets/sitesourcery-og-source.svg"), "utf8"),
]);
const REVIEWED_ARTIFACT_FILES = Object.freeze(Object.fromEntries(await Promise.all(
  REVIEWED_PUBLIC_ARTIFACT_PATHS.map(async (file) => [
    file,
    await readFile(path.join(PROJECT_ROOT, ...file.split("/"))),
  ]),
)));

function clone(value) {
  return structuredClone(value);
}

function heldControl() {
  return {
    version: 3,
    state: "hold",
    allowsDeployment: false,
    allowsCommercialDeployment: false,
    allowsContainmentDeployment: false,
    allowsPublicTruthReconciliationDeployment: false,
    publicTruthReconciliation: {
      state: "hold",
      requiredProductionPredecessor: PRODUCTION_PREDECESSOR_SHA,
      approvedCandidateSha: null,
      authorityReceiptSha256: null,
      reason: "Exact candidate and authority receipt remain unset.",
    },
    reason: "Commercial deployment remains held.",
    containmentReason: "Containment deployment remains held.",
    updatedAt: "2026-07-25",
  };
}

function context(overrides = {}) {
  return {
    actor: "Founder-Test",
    actorId: "987654",
    artifactManifestSha256: ARTIFACT_MANIFEST_SHA,
    candidateSha: CANDIDATE_SHA,
    now: NOW,
    productionPredecessor: PRODUCTION_PREDECESSOR_SHA,
    repository: REPOSITORY_FULL_NAME,
    repositoryId: "123456",
    sourceManifestSha256: SOURCE_MANIFEST_SHA,
    ...overrides,
  };
}

function authorityReceipt(overrides = {}) {
  const receipt = {
    schema: RECEIPT_SCHEMA,
    repository: {
      id: "123456",
      fullName: REPOSITORY_FULL_NAME,
    },
    lineage: {
      candidateBase: CANDIDATE_BASE_SHA,
      candidate: CANDIDATE_SHA,
      pagesPredecessor: {
        deploymentId: "24680",
        commit: PRODUCTION_PREDECESSOR_SHA,
      },
    },
    changedPaths: {
      candidate: [...CANDIDATE_CHANGED_PATHS],
      control: [...CONTROL_CHANGED_PATHS],
    },
    manifests: {
      sourceSha256: SOURCE_MANIFEST_SHA,
      artifactSha256: ARTIFACT_MANIFEST_SHA,
    },
    catalog: {
      sourceDigest: SOURCE_CATALOG_DIGEST,
      projectionDigest: PUBLIC_PROJECTION_DIGEST,
      frozenBaseBlobs: { ...FROZEN_BASE_BLOBS },
    },
    authority: {
      scope: "public-truth-reconciliation-only",
      environment: RELEASE_ENVIRONMENT,
      issuer: {
        githubUserId: "987654",
        login: "Founder-Test",
      },
      issuedAt: "2026-07-25T12:00:00.000Z",
      notBefore: "2026-07-25T12:00:00.000Z",
      expiresAt: "2026-07-25T12:30:00.000Z",
      oneShot: true,
      statement: AUTHORITY_STATEMENT,
      epochSha256: "00".repeat(32),
    },
    flags: {
      allowsDeployment: false,
      allowsCommercialDeployment: false,
      allowsContainmentDeployment: false,
      allowsPublicTruthReconciliationDeployment: true,
    },
  };
  Object.assign(receipt, overrides);
  receipt.authority.epochSha256 = computeReleaseEpochSha256(receipt);
  return receipt;
}

function enabledControl(receipt, receiptSha256 = RECEIPT_SHA) {
  return {
    version: 3,
    state: "hold",
    allowsDeployment: false,
    allowsCommercialDeployment: false,
    allowsContainmentDeployment: false,
    allowsPublicTruthReconciliationDeployment: true,
    publicTruthReconciliation: {
      state: "cleared",
      requiredProductionPredecessor: receipt.lineage.pagesPredecessor.commit,
      approvedCandidateSha: receipt.lineage.candidate,
      authorityReceiptSha256: receiptSha256,
      reason: "One exact public-truth reconciliation is cleared.",
    },
    reason: "General and commercial deployment remain held.",
    containmentReason: "Containment deployment remains held.",
    updatedAt: receipt.authority.issuedAt.slice(0, 10),
  };
}

function pagesObservation(receipt = authorityReceipt()) {
  return {
    url: `https://api.github.com/repos/${REPOSITORY_FULL_NAME}/pages/builds/${receipt.lineage.pagesPredecessor.deploymentId}`,
    status: "built",
    error: { message: null },
    pusher: { login: "prior-deployer", id: 112233 },
    commit: receipt.lineage.pagesPredecessor.commit,
    duration: 12345,
    created_at: "2026-07-25T11:29:00Z",
    updated_at: "2026-07-25T11:30:00Z",
  };
}

function truthFixture() {
  return {
    termsHtml: [
      "Site Sourcery is the brand presentation of the filed alternate name SITESOURCERY. Desiderata Labs LLC is the legal seller.",
      "Site Sourcery accepts inquiries for Custom websites, website assessments, separately scoped Care, and working-system projects.",
      "Custom work begins only through a written quote or scope and a separately accepted agreement.",
      "Payment alone does not authorize work or publication.",
      "Ownership of the agreed client deliverables transfers only after final payment.",
      "The Responder page is planning only. It sends no messages, takes no payment, and starts no setup or service.",
      "The Responder remains held until its telephony, A2P registration, message delivery, opt-out handling, monitoring, lifecycle terms, and customer proof are complete.",
      "Ongoing Care requires its own written scope, and optional Custom Care plan details and prices remain held.",
      "Provider hosting, public Internet publication, real billing, DNS work, and provider-side storage require a separately released service.",
      "Using the current maker does not create an account, control room, project record, or saved acceptance.",
      "Facts and made versions stay only in the current tab; refreshing the page or closing the tab clears them.",
      "The free guest maker makes temporary tab-only versions and previews. It offers no account, saved project, Checkout, or Download.",
      "This maker has no Publish button or publication state.",
      "The current maker does not record a safety hold, report, appeal, restoration, review history, or enforcement state.",
    ].join(" "),
    privacyHtml: [
      "Desiderata Labs LLC operates this website under the filed New Jersey alternate name SITESOURCERY. Site Sourcery is the brand presentation of SITESOURCERY. Desiderata Labs LLC is the legal seller.",
      "The public pages in this release are built without an inquiry form, visitor upload, advertising tracker, or page-level analytics.",
      "The Start chooser uses selected buttons only to show a recommendation on the current page and does not send that selection.",
      "The Responder is held from sale. Its public page describes an intended flow already present in the page and does not ask for customer data, store a setup, contact a provider, create a quote, take payment, or activate a message, booking, review request, invoice action, or other integration.",
      "A guest may build, revise, and test a private preview without an account. Choosing to retain it as an editor project requires the signed-in account path and accepted project documents.",
      "Made versions are stored in this tab’s session storage so they can survive a refresh or a payment return.",
      "Download does not create a public Internet address or an ongoing website-hosting service.",
      "Site Sourcery’s preflight does not call a registrar availability, pricing, reservation, or purchase API.",
      "Secure card entry belongs to Stripe at checkout.",
      "Alakazam has no active customer lifecycle or retention schedule under this notice.",
      "The ordinary public pages and guest preview do not submit a safety report or support ticket.",
      "Email sent to sitesourcery@proton.me is processed through Proton Mail.",
      "If you call or email, Site Sourcery may retain the communication and reasonable business records needed to respond, scope work, document decisions, deliver accepted work, protect the service, and meet legal obligations.",
    ].join(" "),
    contactHtml: [
      "Project inquiries are open",
      "You do not need to know the service name or prepare a formal brief.",
      "If the work is a fit, you see the full scope and price in writing before paying.",
      "This is Site Sourcery’s current public email address.",
      "If the email link does not open an app, copy the address above.",
      "Do not send passwords, full payment-card details, health information, or sensitive customer records.",
      "(856) 244-1220",
      "sitesourcery@proton.me",
    ].join(" "),
    workflowText: CURRENT_WORKFLOW_TEXT,
    ogSourceText: CURRENT_OG_SOURCE_TEXT,
  };
}

function manifestFor(files) {
  const entries = Object.entries(files)
    .map(([file, bytes]) => {
      const buffer = Buffer.from(bytes);
      return { mode: "100644", path: file, sha256: sha256(buffer), size: buffer.length };
    })
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return {
    count: entries.length,
    entries,
    sha256: sha256(stableStringify(entries)),
  };
}

function artifactManifestFor(files) {
  const entries = Object.entries(files)
    .map(([file, bytes]) => {
      const buffer = Buffer.from(bytes);
      return { path: file, sha256: sha256(buffer), size: buffer.length };
    })
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return {
    count: entries.length,
    entries,
    sha256: sha256(stableStringify(entries)),
  };
}

function productionFiles(overrides = {}) {
  const files = {
    "404.html": "<!doctype html><meta name=\"robots\" content=\"noindex\"><h1>404</h1>",
  };
  for (const [route, file] of Object.entries(PRODUCTION_CANONICAL_ROUTE_FILES)) {
    const canonical = new URL(route, `${PRODUCTION_ORIGIN}/`).href;
    files[file] = `<!doctype html><link rel="canonical" href="${canonical}"><h1>${route}</h1>`;
  }
  for (const [file, target] of Object.entries(PRODUCTION_LEGACY_REDIRECTS)) {
    if (file === SOURCE_ONLY_LEGACY_REDIRECT) continue;
    const canonicalTarget = new URL(target, `${PRODUCTION_ORIGIN}/`);
    canonicalTarget.hash = "";
    const canonical = canonicalTarget.href;
    files[file] = [
      "<!doctype html>",
      '<meta name="robots" content="noindex">',
      `<meta http-equiv="refresh" content="0;url=${target}">`,
      `<link rel="canonical" href="${canonical}">`,
      `<a href="${target}">Continue</a>`,
    ].join("");
  }
  return { ...files, ...overrides };
}

function liveFixtureFetch(files, mutate = ({ bytes, status }) => ({ bytes, status })) {
  const requests = [];
  const byPath = new Map(
    Object.keys(files).map((file) => [artifactPublicPath(file), file]),
  );
  const fetchImpl = async (url, options) => {
    requests.push({ options, url });
    assert.ok(options.method === "GET" || options.method === "HEAD");
    assert.equal(options.redirect, "manual");
    assert.equal(Object.hasOwn(options, "body"), false);
    const pathname = new URL(url).pathname;
    const file = byPath.get(pathname) ?? "404.html";
    const expectedStatus = byPath.has(pathname) ? 200 : 404;
    const changed = mutate({
      bytes: Buffer.from(files[file]),
      file,
      method: options.method,
      pathname,
      status: expectedStatus,
    });
    return new Response(options.method === "HEAD" ? null : changed.bytes, {
      headers: { "content-type": file.endsWith(".html") ? "text/html" : "application/octet-stream" },
      status: changed.status,
    });
  };
  return { fetchImpl, requests };
}

async function withArtifact(files, callback) {
  const scratch = await mkdtemp(path.join(tmpdir(), "public-truth-artifact-test-"));
  try {
    for (const [file, contents] of Object.entries(files)) {
      const absolute = path.join(scratch, ...file.split("/"));
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, contents);
    }
    return await callback(scratch);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

function reviewedArtifactFiles(overrides = {}) {
  return { ...REVIEWED_ARTIFACT_FILES, ...overrides };
}

async function withReviewedArtifact(overrides, callback) {
  const files = reviewedArtifactFiles(overrides);
  return withArtifact(files, (root) => callback(root, files));
}

function git(root, ...args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  return result.stdout.trim();
}

async function withGitRepository(callback) {
  const scratch = await mkdtemp(path.join(tmpdir(), "public-truth-git-test-"));
  try {
    git(scratch, "init", "-q");
    git(scratch, "config", "user.name", "Verifier Test");
    git(scratch, "config", "user.email", "verifier@example.invalid");
    return await callback(scratch);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

test("candidate changed-path contract is exact, sorted, unique, and complete", () => {
  const expected = [
    ".github/workflows/containment.yml",
    ".github/workflows/pages.yml",
    ".github/workflows/public-truth-reconciliation.yml",
    ".github/workflows/site-quality.yml",
    "404.html",
    "about.html",
    "about/index.html",
    "abracadabra/abracadabra-showcase.js",
    "abracadabra/app/abracadabra-app.css",
    "abracadabra/app/abracadabra-app.js",
    "abracadabra/app/abracadabra-compiler.js",
    "abracadabra/app/abracadabra-control.js",
    "abracadabra/app/index.html",
    "abracadabra/how/index.html",
    "abracadabra/index.html",
    "abracadabra/platform/abracadabra-platform.js",
    "abracadabra/site/index.html",
    "abracadabra/site/viewer.css",
    "abracadabra/site/viewer.js",
    "assets/portfolio-sconesourcery-v3-720.webp",
    "assets/site-sourcery-hive-orchestra-v4.webp",
    "assets/site-sourcery-storm-atelier-v4.webp",
    "assets/work-demo-bright-spark-1440.webp",
    "assets/work-demo-bright-spark-720.webp",
    "assets/work-demo-bright-spark.png",
    "assets/work-demo-trattoria-1440.webp",
    "assets/work-demo-trattoria-720.webp",
    "assets/work-demo-trattoria.png",
    "assets/work-scone-current-1440.webp",
    "assets/work-scone-current-720.webp",
    "assets/work-scone-current.png",
    "atelier-commerce.js",
    "atelier-story.css",
    "automation.html",
    "contact.html",
    "contact/index.html",
    "custom/index.html",
    "custom/process/index.html",
    "custom/scope/index.html",
    "data/public-catalog.json",
    "data/release-control.json",
    "faq.html",
    "faq/index.html",
    "hive/hive-planner.js",
    "hive/index.html",
    "how-it-works.html",
    "index.html",
    "legal/index.html",
    "legal/privacy/index.html",
    "legal/privacy/versions/SS-HOSTED-PRIVACY-2026-07-30-V2/index.html",
    "legal/website-terms/index.html",
    "og.png",
    "package.json",
    "pricing.html",
    "print-collateral/sitesourcery-card-finalist-v9.html",
    "print-collateral/sitesourcery-card-finalist-v9.pdf",
    "privacy.html",
    "scripts/assets/sitesourcery-og-source.svg",
    "scripts/audit-artifact-from-sitemap.mjs",
    "scripts/browser-audit-vnext.mjs",
    "scripts/build-contained-artifact.mjs",
    "scripts/build-pages.mjs",
    "scripts/check-abracadabra-v1.mjs",
    "scripts/check-pricing.mjs",
    "scripts/check-routes.mjs",
    "scripts/check-site-vnext.mjs",
    "scripts/check-static.mjs",
    "scripts/containment-contract.mjs",
    "scripts/generate-og.mjs",
    "scripts/generate-site-vnext.mjs",
    "scripts/install-reviewed-chromium.sh",
    "scripts/payment-provider-placeholder.mjs",
    "scripts/prepare-containment.mjs",
    "scripts/private-preview/design-system.css",
    "scripts/private-preview/index.html",
    "scripts/private-preview/preview.js",
    "scripts/sync-shared-chrome.mjs",
    "scripts/test/abracadabra-platform.test.mjs",
    "scripts/test/abracadabra-v1.test.mjs",
    "scripts/test/browser-release-gate.test.mjs",
    "scripts/test/hive-planner.test.mjs",
    "scripts/test/payment-provider-placeholder.test.mjs",
    "scripts/test/public-truth-release.test.mjs",
    "scripts/test/site-vnext.test.mjs",
    "scripts/verify-public-truth-release.mjs",
    "scripts/visual-contact-sheet.html",
    "sitemap.xml",
    "solutions/index.html",
    "start/index.html",
    "style.css",
    "terms.html",
    "thanks.html",
    "the-difference.html",
    "the-meter.html",
    "the-moat.html",
    "the-responder.html",
    "vnext.css",
    "vnext.js",
    "work/index.html",
    "work/work.css",
  ];
  assert.deepEqual(CANDIDATE_CHANGED_PATHS, expected);
  assert.equal(new Set(CANDIDATE_CHANGED_PATHS).size, CANDIDATE_CHANGED_PATHS.length);
  assert.deepEqual([...CANDIDATE_CHANGED_PATHS].sort(), CANDIDATE_CHANGED_PATHS);
  assert.deepEqual(CONTROL_CHANGED_PATHS, [
    "data/public-truth-authority.json",
    "data/release-control.json",
  ]);
  assert.equal(RELEASE_ENVIRONMENT, "github-pages");
  assert.equal(MIN_PREDEPLOY_AUTHORITY_REMAINING_MS, 5 * 60 * 1000);
  assert.equal(POSTDEPLOY_EVIDENCE_RETENTION_DAYS >= 90, true);
  assert.equal(POSTDEPLOY_PROPAGATION_WINDOW_MS, 10 * 60 * 1000);
  assert.equal(POSTDEPLOY_POLL_INTERVAL_MS, 15 * 1000);
  assert.equal(POSTDEPLOY_REQUEST_TIMEOUT_MS, 15 * 1000);
  assert.equal(POSTDEPLOY_REQUIRED_EXACT_SNAPSHOTS, 2);
  assert.equal(PRODUCTION_ORIGIN, "https://sitesourcery.com");
});

test("artifact exclusion contract covers generated, server, workflow, governance, data, and print sources", () => {
  for (const name of [".github", "_hosted", "data", "flyer.html", "print-collateral", "scripts", "server", "QUALITY.md", "package.json"]) {
    assert.ok(EXCLUDED_ARTIFACT_TOP_LEVEL.includes(name), name);
  }
});

test("verifier publication ledger independently matches the reviewed 75-file held builder ledger", () => {
  assert.equal(REVIEWED_PUBLIC_ARTIFACT_PATHS.length, 75);
  assert.deepEqual(REVIEWED_PUBLIC_ARTIFACT_PATHS, publicFileAllowlist);
  assert.deepEqual(
    [...REVIEWED_PUBLIC_ARTIFACT_PATHS].sort(),
    REVIEWED_PUBLIC_ARTIFACT_PATHS,
  );
  for (const file of LEGACY_SOURCE_ONLY_ARTIFACT_PATHS) {
    assert.equal(REVIEWED_PUBLIC_ARTIFACT_PATHS.includes(file), false, file);
  }
});

test("stableStringify and sha256 produce deterministic identities", () => {
  assert.equal(stableStringify({ b: 2, a: [true, null] }), '{"a":[true,null],"b":2}');
  assert.equal(sha256("truth"), "c5c4bad89ee44b4da0321344964f145dd3023fc1ab0d9c2473e2716b788481ae");
});

test("strict JSON accepts ordinary nested JSON", () => {
  assert.deepEqual(parseStrictJson('{"a":[1,true,null],"b":"ok"}'), { a: [1, true, null], b: "ok" });
});

test("strict JSON rejects duplicate, prohibited, trailing, unsafe-number, and deep inputs", () => {
  assert.throws(() => parseStrictJson('{"a":1,"a":2}'), /duplicate JSON key/u);
  assert.throws(() => parseStrictJson('{"__proto__":1}'), /prohibited JSON key/u);
  assert.throws(() => parseStrictJson('{"a":1} true'), /trailing syntax/u);
  assert.throws(() => parseStrictJson('{"a":9007199254740992}'), /finite safe integer/u);
  assert.throws(() => parseStrictJson(`${"[".repeat(34)}0${"]".repeat(34)}`), /deeply nested/u);
});

test("strict JSON rejects malformed numeric and object syntax", () => {
  assert.throws(() => parseStrictJson('{"a":01}'), /JSON/u);
  assert.throws(() => parseStrictJson('{"a" 1}'), /missing a colon/u);
  assert.throws(() => parseStrictJson('{"a":1,}'), /object key syntax/u);
});

test("candidate CLI parses only the complete exact flag set", () => {
  assert.deepEqual(parseCli([
    "--mode", "candidate",
    "--root", "/repo",
    "--candidate-sha", CANDIDATE_SHA,
    "--production-predecessor", PRODUCTION_PREDECESSOR_SHA,
  ]), {
    mode: "candidate",
    root: "/repo",
    candidateSha: CANDIDATE_SHA,
    productionPredecessor: PRODUCTION_PREDECESSOR_SHA,
  });
});

test("control CLI parses only the complete exact flag set", () => {
  assert.deepEqual(parseCli([
    "--mode", "control",
    "--root", "/repo",
    "--candidate-sha", CANDIDATE_SHA,
    "--production-predecessor", PRODUCTION_PREDECESSOR_SHA,
    "--control-sha", "89".repeat(20),
    "--authority-receipt", RECEIPT_PATH,
  ]), {
    mode: "control",
    root: "/repo",
    candidateSha: CANDIDATE_SHA,
    productionPredecessor: PRODUCTION_PREDECESSOR_SHA,
    controlSha: "89".repeat(20),
    authorityReceipt: RECEIPT_PATH,
  });
});

test("predeploy CLI requires the exact control and extracted-artifact flag set", () => {
  assert.deepEqual(parseCli([
    "--mode", "predeploy",
    "--root", "/repo",
    "--artifact-root", "/runner/predeploy-site",
    "--candidate-sha", CANDIDATE_SHA,
    "--production-predecessor", PRODUCTION_PREDECESSOR_SHA,
    "--control-sha", "89".repeat(20),
    "--authority-receipt", RECEIPT_PATH,
  ]), {
    mode: "predeploy",
    root: "/repo",
    candidateSha: CANDIDATE_SHA,
    productionPredecessor: PRODUCTION_PREDECESSOR_SHA,
    controlSha: "89".repeat(20),
    authorityReceipt: RECEIPT_PATH,
    artifactRoot: "/runner/predeploy-site",
  });
  assert.throws(() => parseCli([
    "--mode", "predeploy",
    "--root", "/repo",
    "--candidate-sha", CANDIDATE_SHA,
    "--production-predecessor", PRODUCTION_PREDECESSOR_SHA,
    "--control-sha", "89".repeat(20),
    "--authority-receipt", RECEIPT_PATH,
  ]), /--artifact-root/u);
});

test("postdeploy CLI requires the exact artifact, origin, deployment, and evidence identities", () => {
  assert.deepEqual(parseCli([
    "--mode", "postdeploy",
    "--root", "/repo",
    "--artifact-root", "/runner/postdeploy-site",
    "--artifact-id", "123456",
    "--candidate-sha", CANDIDATE_SHA,
    "--production-predecessor", PRODUCTION_PREDECESSOR_SHA,
    "--control-sha", "89".repeat(20),
    "--authority-receipt", RECEIPT_PATH,
    "--origin", PRODUCTION_ORIGIN,
    "--deployment-page-url", `${PRODUCTION_ORIGIN}/`,
    "--deployment-status", "success",
    "--evidence", "/runner/public-truth-production-proof.json",
  ]), {
    mode: "postdeploy",
    root: "/repo",
    candidateSha: CANDIDATE_SHA,
    productionPredecessor: PRODUCTION_PREDECESSOR_SHA,
    controlSha: "89".repeat(20),
    authorityReceipt: RECEIPT_PATH,
    artifactRoot: "/runner/postdeploy-site",
    artifactId: "123456",
    deploymentPageUrl: `${PRODUCTION_ORIGIN}/`,
    deploymentStatus: "success",
    evidence: "/runner/public-truth-production-proof.json",
    origin: PRODUCTION_ORIGIN,
  });
});

test("CLI rejects missing, unknown, duplicate, positional, and candidate/control-mixed flags", () => {
  assert.throws(() => parseCli(["--mode", "candidate"]), /flags must be exactly/u);
  assert.throws(() => parseCli([
    "--mode", "candidate", "--mode", "control",
    "--root", "/repo", "--candidate-sha", CANDIDATE_SHA,
    "--production-predecessor", PRODUCTION_PREDECESSOR_SHA,
  ]), /duplicate flag/u);
  assert.throws(() => parseCli([
    "--mode", "candidate", "--root", "/repo",
    "--candidate-sha", CANDIDATE_SHA,
    "--production-predecessor", PRODUCTION_PREDECESSOR_SHA,
    "--control-sha", "89".repeat(20),
  ]), /flags must be exactly/u);
  assert.throws(() => parseCli([
    "--mode", "control", "--root", "/repo",
    "--candidate-sha", CANDIDATE_SHA,
    "--production-predecessor", PRODUCTION_PREDECESSOR_SHA,
    "--control-sha", "89".repeat(20),
  ]), /flags must be exactly/u);
  assert.throws(() => parseCli(["candidate", "true"]), /positional/u);
  assert.throws(() => parseCli(["--mode", "--root"]), /requires one explicit value/u);
  assert.throws(() => parseCli(["--mode", "true"]), /candidate, control, predeploy, or postdeploy/u);
});

test("authority receipt path rejects relative and absolute substitution", () => {
  assert.equal(resolveAuthorityReceiptPath("/repo", RECEIPT_PATH), "/repo/data/public-truth-authority.json");
  assert.equal(resolveAuthorityReceiptPath("/repo", "/repo/data/public-truth-authority.json"), "/repo/data/public-truth-authority.json");
  assert.throws(() => resolveAuthorityReceiptPath("/repo", "receipt.json"), /path must be exactly/u);
  assert.throws(() => resolveAuthorityReceiptPath("/repo", "/tmp/public-truth-authority.json"), /path must be exactly/u);
  assert.throws(() => resolveAuthorityReceiptPath("/repo", "data/../data/public-truth-authority.json"), /path must be exactly/u);
});

test("held candidate control is accepted and remains nonauthorizing", () => {
  const result = validateCandidateControl(heldControl());
  assert.equal(result.state, "hold");
  assert.equal(result.approvedCandidateSha, null);
  assert.equal(result.authorityReceiptSha256, null);
});

test("current candidate release-control bytes are held and nonauthorizing", async () => {
  const raw = await readFile(path.join(PROJECT_ROOT, "data/release-control.json"), "utf8");
  const control = parseStrictJson(raw);
  const publicTruth = validateCandidateControl(control);
  assert.equal(control.state, "hold");
  assert.equal(control.allowsDeployment, false);
  assert.equal(control.allowsCommercialDeployment, false);
  assert.equal(control.allowsContainmentDeployment, false);
  assert.equal(control.allowsPublicTruthReconciliationDeployment, false);
  assert.equal(publicTruth.state, "hold");
});

test("candidate control rejects every bare boolean or mixed authority grant", () => {
  assert.throws(() => validateCandidateControl(true), /must be an object/u);
  for (const field of [
    "allowsDeployment",
    "allowsCommercialDeployment",
    "allowsContainmentDeployment",
    "allowsPublicTruthReconciliationDeployment",
  ]) {
    const control = heldControl();
    control[field] = true;
    assert.throws(() => validateCandidateControl(control), /every deployment authority held/u, field);
  }
});

test("candidate control rejects null-binding and schema substitutions", () => {
  const candidate = heldControl();
  candidate.publicTruthReconciliation.approvedCandidateSha = CANDIDATE_SHA;
  assert.throws(() => validateCandidateControl(candidate), /held identity/u);
  const receiptBound = heldControl();
  receiptBound.publicTruthReconciliation.authorityReceiptSha256 = RECEIPT_SHA;
  assert.throws(() => validateCandidateControl(receiptBound), /held identity/u);
  const extra = heldControl();
  extra.publicTruthReconciliation.extra = false;
  assert.throws(() => validateCandidateControl(extra), /keys must be exactly/u);
});

test("exact authority receipt validates in its live window", () => {
  const receipt = authorityReceipt();
  assert.equal(validateReceipt(receipt, context()), receipt);
  assert.equal(receipt.authority.epochSha256, computeReleaseEpochSha256(receipt));
});

test("receipt rejects bare booleans, extra keys, and field type confusion", () => {
  assert.throws(() => validateReceipt(true, context()), /must be an object/u);
  const extra = authorityReceipt();
  extra.authority.allow = true;
  assert.throws(() => validateReceipt(extra, context()), /keys must be exactly/u);
  const booleanId = authorityReceipt();
  booleanId.repository.id = true;
  booleanId.authority.epochSha256 = computeReleaseEpochSha256(booleanId);
  assert.throws(() => validateReceipt(booleanId, context()), /canonical decimal string/u);
});

test("receipt rejects candidate and control changed-path substitutions", () => {
  const candidatePath = authorityReceipt();
  candidatePath.changedPaths.candidate[0] = "index.html";
  candidatePath.authority.epochSha256 = computeReleaseEpochSha256(candidatePath);
  assert.throws(() => validateReceipt(candidatePath, context()), /exact ordered allowlist/u);
  const controlPath = authorityReceipt();
  controlPath.changedPaths.control.reverse();
  controlPath.authority.epochSha256 = computeReleaseEpochSha256(controlPath);
  assert.throws(() => validateReceipt(controlPath, context()), /exact ordered allowlist/u);
});

test("receipt rejects source and artifact manifest mutation", () => {
  const source = authorityReceipt();
  source.manifests.sourceSha256 = "12".repeat(32);
  source.authority.epochSha256 = computeReleaseEpochSha256(source);
  assert.throws(() => validateReceipt(source, context()), /sourceSha256/u);
  const artifact = authorityReceipt();
  artifact.manifests.artifactSha256 = "34".repeat(32);
  artifact.authority.epochSha256 = computeReleaseEpochSha256(artifact);
  assert.throws(() => validateReceipt(artifact, context()), /artifactSha256/u);
});

test("receipt rejects source catalog and frozen-blob mutation", () => {
  const catalog = authorityReceipt();
  catalog.catalog.sourceDigest = "12".repeat(32);
  catalog.authority.epochSha256 = computeReleaseEpochSha256(catalog);
  assert.throws(() => validateReceipt(catalog, context()), /sourceDigest/u);
  const frozen = authorityReceipt();
  frozen.catalog.frozenBaseBlobs["package-lock.json"] = "12".repeat(20);
  frozen.authority.epochSha256 = computeReleaseEpochSha256(frozen);
  assert.throws(() => validateReceipt(frozen, context()), /package-lock\.json/u);
});

test("receipt rejects stale or wrong production predecessor and replay epoch", () => {
  const wrong = authorityReceipt();
  wrong.lineage.pagesPredecessor.commit = "45".repeat(20);
  wrong.authority.epochSha256 = computeReleaseEpochSha256(wrong);
  assert.throws(() => validateReceipt(wrong, context()), /pagesPredecessor\.commit/u);
  const replayed = authorityReceipt();
  assert.throws(
    () => validateReceipt(replayed, context({ productionPredecessor: "67".repeat(20) })),
    /pagesPredecessor\.commit/u,
  );
});

test("latest Pages observation exactly proves the receipt predecessor", () => {
  const receipt = authorityReceipt();
  const observation = pagesObservation(receipt);
  assert.equal(validatePagesObservation(observation, receipt), observation);
});

test("latest Pages observation rejects stale commit, substituted id, failure, future, and extra fields", () => {
  const receipt = authorityReceipt();
  const stale = pagesObservation(receipt);
  stale.commit = CANDIDATE_SHA;
  assert.throws(() => validatePagesObservation(stale, receipt), /build commit/u);
  const substitutedId = pagesObservation(receipt);
  substitutedId.url = `https://api.github.com/repos/${REPOSITORY_FULL_NAME}/pages/builds/999`;
  assert.throws(() => validatePagesObservation(substitutedId, receipt), /build URL/u);
  const failed = pagesObservation(receipt);
  failed.status = "errored";
  failed.error.message = "failed";
  assert.throws(() => validatePagesObservation(failed, receipt), /not one successful/u);
  const future = pagesObservation(receipt);
  future.updated_at = "2026-07-25T12:01:00Z";
  assert.throws(() => validatePagesObservation(future, receipt), /precede the authority epoch/u);
  const extra = pagesObservation(receipt);
  extra.workflow = "substitute";
  assert.throws(() => validatePagesObservation(extra, receipt), /keys must be exactly/u);
});

test("predeploy state revalidates exact HOLD candidate, control, receipt, time, and predecessor", () => {
  const receipt = authorityReceipt();
  const receiptRaw = Buffer.from(JSON.stringify(receipt));
  const result = validatePredeployState({
    candidateControl: heldControl(),
    enabledControl: enabledControl(receipt, sha256(receiptRaw)),
    receiptRaw,
    context: context(),
    pagesObservation: pagesObservation(receipt),
  });
  assert.deepEqual(result.receipt, receipt);
  assert.equal(result.receiptSha256, sha256(receiptRaw));
});

test("predeploy authority requires the exact minimum remaining TTL boundary", () => {
  const receipt = authorityReceipt();
  const receiptRaw = Buffer.from(JSON.stringify(receipt));
  const expiresAt = Date.parse(receipt.authority.expiresAt);
  const base = {
    candidateControl: heldControl(),
    enabledControl: enabledControl(receipt, sha256(receiptRaw)),
    receiptRaw,
    pagesObservation: pagesObservation(receipt),
  };
  assert.equal(
    validatePredeployState({
      ...base,
      context: context({ now: expiresAt - MIN_PREDEPLOY_AUTHORITY_REMAINING_MS }),
    }).receiptSha256,
    sha256(receiptRaw),
  );
  assert.throws(
    () => validatePredeployState({
      ...base,
      context: context({ now: expiresAt - MIN_PREDEPLOY_AUTHORITY_REMAINING_MS + 1 }),
    }),
    new RegExp(`at least ${MIN_PREDEPLOY_AUTHORITY_REMAINING_MS}ms remaining`, "u"),
  );
});

test("predeploy state rejects expiry, predecessor drift, candidate/control mix, and artifact identity drift", () => {
  const receipt = authorityReceipt();
  const receiptRaw = Buffer.from(JSON.stringify(receipt));
  const base = {
    candidateControl: heldControl(),
    enabledControl: enabledControl(receipt, sha256(receiptRaw)),
    receiptRaw,
    context: context(),
    pagesObservation: pagesObservation(receipt),
  };
  assert.throws(
    () => validatePredeployState({ ...base, context: context({ now: Date.parse("2026-07-25T12:30:00.000Z") }) }),
    /time window/u,
  );
  const driftedPages = pagesObservation(receipt);
  driftedPages.commit = CANDIDATE_SHA;
  assert.throws(
    () => validatePredeployState({ ...base, pagesObservation: driftedPages }),
    /build commit/u,
  );
  assert.throws(
    () => validatePredeployState({ ...base, candidateControl: enabledControl(receipt, sha256(receiptRaw)) }),
    /every deployment authority held/u,
  );
  assert.throws(
    () => validatePredeployState({
      ...base,
      context: context({ artifactManifestSha256: "12".repeat(32) }),
    }),
    /artifactSha256/u,
  );
  const noCurrentTime = context();
  delete noCurrentTime.now;
  assert.throws(
    () => validatePredeployState({ ...base, context: noCurrentTime }),
    /current time/u,
  );
});

test("predeploy state rejects non-byte, malformed, and digest-substituted receipts", () => {
  const receipt = authorityReceipt();
  const receiptRaw = Buffer.from(JSON.stringify(receipt));
  const base = {
    candidateControl: heldControl(),
    enabledControl: enabledControl(receipt, sha256(receiptRaw)),
    context: context(),
    pagesObservation: pagesObservation(receipt),
  };
  assert.throws(
    () => validatePredeployState({ ...base, receiptRaw: JSON.stringify(receipt) }),
    /must be raw bytes/u,
  );
  assert.throws(
    () => validatePredeployState({ ...base, receiptRaw: Buffer.from('{"schema":') }),
    /JSON/u,
  );
  const substitutedControl = enabledControl(receipt, "12".repeat(32));
  assert.throws(
    () => validatePredeployState({ ...base, enabledControl: substitutedControl, receiptRaw }),
    /does not exactly bind/u,
  );
});

test("receipt rejects epoch mutation even when all visible bindings are unchanged", () => {
  const receipt = authorityReceipt();
  receipt.authority.epochSha256 = "12".repeat(32);
  assert.throws(() => validateReceipt(receipt, context()), /epochSha256/u);
});

test("receipt rejects expired, future, inverted, and overlong authority windows", () => {
  const expired = authorityReceipt();
  expired.authority.expiresAt = "2026-07-25T12:15:00.000Z";
  expired.authority.epochSha256 = computeReleaseEpochSha256(expired);
  assert.throws(() => validateReceipt(expired, context()), /time window/u);

  const future = authorityReceipt();
  future.authority.issuedAt = "2026-07-25T12:30:01.000Z";
  future.authority.notBefore = "2026-07-25T12:30:01.000Z";
  future.authority.expiresAt = "2026-07-25T13:00:00.000Z";
  future.authority.epochSha256 = computeReleaseEpochSha256(future);
  assert.throws(() => validateReceipt(future, context()), /time window/u);

  const inverted = authorityReceipt();
  inverted.authority.issuedAt = "2026-07-25T12:10:00.000Z";
  inverted.authority.notBefore = "2026-07-25T12:00:00.000Z";
  inverted.authority.expiresAt = "2026-07-25T12:30:00.000Z";
  inverted.authority.epochSha256 = computeReleaseEpochSha256(inverted);
  assert.throws(() => validateReceipt(inverted, context()), /notBefore/u);

  const overlong = authorityReceipt();
  overlong.authority.expiresAt = new Date(Date.parse(overlong.authority.issuedAt) + MAX_AUTHORITY_LIFETIME_MS + 1000).toISOString();
  overlong.authority.epochSha256 = computeReleaseEpochSha256(overlong);
  assert.throws(() => validateReceipt(overlong, context()), /no longer than one hour/u);
});

test("receipt rejects wrong repository, issuer, and authority scope", () => {
  const repository = authorityReceipt();
  repository.repository.fullName = "attacker/substitute";
  repository.authority.epochSha256 = computeReleaseEpochSha256(repository);
  assert.throws(() => validateReceipt(repository, context()), /repository\.fullName/u);
  const issuer = authorityReceipt();
  issuer.authority.issuer.login = "Other-Actor";
  issuer.authority.epochSha256 = computeReleaseEpochSha256(issuer);
  assert.throws(() => validateReceipt(issuer, context()), /issuer\.login/u);
  const scope = authorityReceipt();
  scope.authority.scope = "general-deployment";
  scope.authority.epochSha256 = computeReleaseEpochSha256(scope);
  assert.throws(() => validateReceipt(scope, context()), /authority\.scope/u);
});

test("receipt rejects combined commercial, containment, or general authority", () => {
  for (const field of ["allowsDeployment", "allowsCommercialDeployment", "allowsContainmentDeployment"]) {
    const receipt = authorityReceipt();
    receipt.flags[field] = true;
    receipt.authority.epochSha256 = computeReleaseEpochSha256(receipt);
    assert.throws(() => validateReceipt(receipt, context()), /grant only public-truth/u, field);
  }
  const noPublicTruth = authorityReceipt();
  noPublicTruth.flags.allowsPublicTruthReconciliationDeployment = false;
  noPublicTruth.authority.epochSha256 = computeReleaseEpochSha256(noPublicTruth);
  assert.throws(() => validateReceipt(noPublicTruth, context()), /grant only public-truth/u);
});

test("GitHub runtime authority accepts only first-attempt manual main-branch control execution", () => {
  const controlSha = "89".repeat(20);
  const env = {
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_REPOSITORY: REPOSITORY_FULL_NAME,
    GITHUB_REPOSITORY_ID: "123456",
    GITHUB_ACTOR: "Founder-Test",
    GITHUB_ACTOR_ID: "987654",
    GITHUB_RUN_ID: "24680",
    GITHUB_SHA: controlSha,
    GITHUB_WORKFLOW_SHA: controlSha,
  };
  assert.deepEqual(validateRuntimeAuthorityEnvironment(env, controlSha), {
    repository: REPOSITORY_FULL_NAME,
    repositoryId: "123456",
    actor: "Founder-Test",
    actorId: "987654",
  });
  for (const [field, value] of [
    ["GITHUB_EVENT_NAME", "push"],
    ["GITHUB_REF", "refs/heads/feature"],
    ["GITHUB_RUN_ATTEMPT", "2"],
    ["GITHUB_RUN_ATTEMPT", "true"],
    ["GITHUB_REPOSITORY", "attacker/substitute"],
    ["GITHUB_SHA", CANDIDATE_SHA],
    ["GITHUB_WORKFLOW_SHA", CANDIDATE_SHA],
  ]) {
    assert.throws(
      () => validateRuntimeAuthorityEnvironment({ ...env, [field]: value }, controlSha),
      new RegExp(field, "u"),
      `${field}=${value}`,
    );
  }
});

test("exact enabled control validates against receipt and raw receipt digest", () => {
  const receipt = authorityReceipt();
  const control = enabledControl(receipt);
  assert.equal(validateEnabledControl(control, receipt, RECEIPT_SHA, context()).state, "cleared");
});

test("candidate/control mixing and receipt digest substitution fail closed", () => {
  const receipt = authorityReceipt();
  assert.throws(() => validateEnabledControl(heldControl(), receipt, RECEIPT_SHA, context()), /grant only public-truth/u);
  assert.throws(() => validateCandidateControl(enabledControl(receipt)), /every deployment authority held/u);
  const wrongCandidate = enabledControl(receipt);
  wrongCandidate.publicTruthReconciliation.approvedCandidateSha = "89".repeat(20);
  assert.throws(() => validateEnabledControl(wrongCandidate, receipt, RECEIPT_SHA, context()), /does not exactly bind/u);
  const wrongDigest = enabledControl(receipt, "12".repeat(32));
  assert.throws(() => validateEnabledControl(wrongDigest, receipt, RECEIPT_SHA, context()), /does not exactly bind/u);
});

test("enabled control rejects commercial/containment grants and authority-date mismatch", () => {
  const receipt = authorityReceipt();
  for (const field of ["allowsDeployment", "allowsCommercialDeployment", "allowsContainmentDeployment"]) {
    const control = enabledControl(receipt);
    control[field] = true;
    assert.throws(() => validateEnabledControl(control, receipt, RECEIPT_SHA, context()), /grant only public-truth/u);
  }
  const stale = enabledControl(receipt);
  stale.updatedAt = "2026-07-24";
  assert.throws(() => validateEnabledControl(stale, receipt, RECEIPT_SHA, context()), /issuance date/u);
});

test("public-truth text and workflow structural fixture passes", () => {
  assert.deepEqual(validatePublicTruthTextSet(truthFixture()), []);
});

test("actual current public-truth files pass the integrated semantic and workflow contract", async () => {
  const [termsHtml, privacyHtml, contactHtml] = await Promise.all([
    readFile(path.join(PROJECT_ROOT, "legal/website-terms/index.html"), "utf8"),
    readFile(path.join(PROJECT_ROOT, "legal/privacy/index.html"), "utf8"),
    readFile(path.join(PROJECT_ROOT, "contact/index.html"), "utf8"),
  ]);
  assert.deepEqual(validatePublicTruthTextSet({
    termsHtml,
    privacyHtml,
    contactHtml,
    workflowText: CURRENT_WORKFLOW_TEXT,
    ogSourceText: CURRENT_OG_SOURCE_TEXT,
  }), []);
});

test("public-truth text rejects stale claims and missing workflow gates", () => {
  const fixture = truthFixture();
  fixture.termsHtml += " This public site accepts payments.";
  fixture.termsHtml += " The current tool lets an owner create a local account and project.";
  fixture.privacyHtml += " Abracadabra’s private build contains local billing-lifecycle rehearsal states.";
  fixture.contactHtml += " This is a verified public route.";
  fixture.workflowText = "on:\n  push:\npermissions: {}\n";
  const errors = validatePublicTruthTextSet(fixture);
  assert.ok(
    errors.filter((error) =>
      error.includes("legal/website-terms/index.html contains forbidden visible semantics")).length >= 2,
  );
  assert.ok(errors.some((error) =>
    error.includes("legal/privacy/index.html contains forbidden visible semantics")));
  assert.ok(errors.some((error) => error.includes("verified public")));
  assert.ok(errors.some((error) => error.includes("exactly workflow_dispatch")));
  assert.ok(errors.some((error) => error.includes("--mode candidate")));
});

test("public-truth semantics reject the stale OG posture and missing reviewed contact copy", () => {
  const fixture = truthFixture();
  fixture.ogSourceText = [
    "<svg><text>Planning preview · Send an inquiry</text>",
    "<text>Footprint and creative direction priced separately.</text></svg>",
  ].join("");
  const errors = validatePublicTruthTextSet(fixture);
  assert.ok(errors.some((error) => error.includes("Custom websites, scoped to fit.")));
  assert.ok(errors.some((error) => error.includes("Personalized scope · (856) 244-1220")));
});

test("public-truth workflow rejects mutable action references and continue-on-error", () => {
  const fixture = truthFixture();
  fixture.workflowText = fixture.workflowText
    .replace(/actions\/checkout@[0-9a-f]{40}/u, "actions/checkout@v4")
    .replace("    steps:", "    continue-on-error: true\n    steps:");
  const errors = validatePublicTruthTextSet(fixture);
  assert.ok(errors.some((error) => error.includes("pinned to an exact commit")));
  assert.ok(errors.some((error) => error.includes("must not continue")));
});

test("public-truth workflow structurally rejects comments and artifact-chain substitutions", () => {
  const exactUploader = "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a";
  const exactRunCheck = "if (!artifact.workflow_run || String(artifact.workflow_run.id) !== runId) {";
  const exactHeadCheck = 'if (artifact.workflow_run.head_sha !== controlSha) throw new Error("artifact control-head mismatch");';
  const variants = [
    [
      CURRENT_WORKFLOW_TEXT.replace(
        "    environment:\n      name: github-pages\n      url:",
        "    environment:\n      name: substituted\n      # name: github-pages\n      url:",
      ),
      /structurally target the exact github-pages environment/u,
    ],
    [
      CURRENT_WORKFLOW_TEXT.replace(
        "artifact_id: ${{ steps.pages-artifact.outputs.artifact-id }}",
        "artifact_id: ${{ steps.pages-artifact.outputs.artifact_id }}\n      # artifact_id: ${{ steps.pages-artifact.outputs.artifact-id }}",
      ),
      /validated artifact-id job output/u,
    ],
    [
      CURRENT_WORKFLOW_TEXT.replace(
        `${exactUploader} # v7.0.1`,
        `actions/upload-artifact@1234567890abcdef1234567890abcdef12345678 # substitute\n        # uses: ${exactUploader}`,
      ),
      /direct pinned actions\/upload-artifact/u,
    ],
    [
      CURRENT_WORKFLOW_TEXT.replace(
        exactRunCheck,
        `if (!artifact.workflow_run || String(artifact.workflow_run.id) === runId) {\n          // ${exactRunCheck}`,
      ),
      /artifact workflow-run binding/u,
    ],
    [
      CURRENT_WORKFLOW_TEXT.replace(
        exactHeadCheck,
        `if (artifact.workflow_run.head_sha === controlSha) throw new Error("substitute");\n          // ${exactHeadCheck}`,
      ),
      /artifact control-head binding/u,
    ],
    [
      CURRENT_WORKFLOW_TEXT.replace(
        "if (run.total_count !== 1 || !Array.isArray(run.artifacts) || run.artifacts.length !== 1) {",
        "if (run.total_count < 100) {\n          // if (run.total_count !== 1 || !Array.isArray(run.artifacts) || run.artifacts.length !== 1) {",
      ),
      /unique current-run artifact check/u,
    ],
    [
      CURRENT_WORKFLOW_TEXT.replace(
        "max_members = 1024",
        "max_members = 65536\n          # max_members = 1024",
      ),
      /safe extractor member bound/u,
    ],
    [
      CURRENT_WORKFLOW_TEXT.replace(
        'unzip -p "$archive" artifact.tar > "$artifact_tar"',
        'unzip "$archive" -d "$site"\n          # unzip -p "$archive" artifact.tar > "$artifact_tar"',
      ),
      /streamed artifact\.tar extraction|must not extract the artifact ZIP directly/u,
    ],
    [
      CURRENT_WORKFLOW_TEXT.replace(
        "          artifact_name: github-pages",
        "          artifact_name: substituted\n          # artifact_name: github-pages",
      ),
      /explicit deploy-pages artifact name/u,
    ],
    [
      CURRENT_WORKFLOW_TEXT.replace(
        "            --mode postdeploy \\",
        "            --mode predeploy \\\n            # --mode postdeploy \\",
      ),
      /postdeploy verifier mode/u,
    ],
    [
      CURRENT_WORKFLOW_TEXT.replace(
        "        id: postdeploy-proof\n        if: ${{ always() }}",
        "        id: postdeploy-proof\n        if: ${{ always() && steps.deployment.outcome == 'success' }}",
      ),
      /postdeploy execution and evidence after every deployment outcome/u,
    ],
    [
      CURRENT_WORKFLOW_TEXT.replace(
        "          retention-days: 90",
        "          retention-days: 89\n          # retention-days: 90",
      ),
      /90-day private postdeploy evidence contract/u,
    ],
    [
      `${CURRENT_WORKFLOW_TEXT}\n# actions/upload-pages-artifact@1234567890abcdef1234567890abcdef12345678\n`,
      /must not use the composite upload-pages-artifact/u,
    ],
  ];
  for (const [workflowText, expected] of variants) {
    const fixture = truthFixture();
    fixture.workflowText = workflowText;
    assert.ok(
      validatePublicTruthTextSet(fixture).some((error) => expected.test(error)),
      expected,
    );
  }
});

test("reviewed OG source and PNG bytes match exact hashes and dimensions", async () => {
  const [source, png] = await Promise.all([
    readFile(path.join(PROJECT_ROOT, "scripts/assets/sitesourcery-og-source.svg")),
    readFile(path.join(PROJECT_ROOT, "og.png")),
  ]);
  assert.equal(sha256(source), OG_SOURCE_SHA256);
  assert.equal(sha256(png), OG_PNG_SHA256);
  assert.deepEqual(validateReviewedOgAssets(source, png), []);
});

test("reviewed OG validation rejects source mutation, PNG mutation, and wrong dimensions", async () => {
  const [source, png] = await Promise.all([
    readFile(path.join(PROJECT_ROOT, "scripts/assets/sitesourcery-og-source.svg")),
    readFile(path.join(PROJECT_ROOT, "og.png")),
  ]);
  const sourceMutation = Buffer.concat([source, Buffer.from(" ")]);
  assert.ok(validateReviewedOgAssets(sourceMutation, png).some((error) => error.includes("social-card source")));
  const pngMutation = Buffer.from(png);
  pngMutation[pngMutation.length - 1] ^= 1;
  assert.ok(validateReviewedOgAssets(source, pngMutation).some((error) => error.includes("reviewed digest")));
  const wrongDimensions = Buffer.from(png);
  wrongDimensions.writeUInt32BE(1199, 16);
  assert.ok(validateReviewedOgAssets(source, wrongDimensions).some((error) => error.includes("1200x630")));
});

test("reviewed V9 business-card source and PDF retain the Google Voice contact truth", async () => {
  const [source, pdf] = await Promise.all([
    readFile(path.join(PROJECT_ROOT, "print-collateral/sitesourcery-card-finalist-v9.html"), "utf8"),
    readFile(path.join(PROJECT_ROOT, "print-collateral/sitesourcery-card-finalist-v9.pdf")),
  ]);
  assert.match(source, /href="tel:\+18562441220"/u);
  assert.match(source, /\(856\) 244-1220/u);
  assert.match(source, /sitesourcery@proton\.me/u);
  assert.ok(pdf.subarray(0, 5).equals(Buffer.from("%PDF-")));
  assert.equal(sha256(pdf), CARD_V9_PDF_SHA256);
});

test("source manifest is deterministic and binds Git blob content", async () => {
  await withGitRepository(async (root) => {
    await writeFile(path.join(root, "index.html"), "first");
    await mkdir(path.join(root, "assets"));
    await writeFile(path.join(root, "assets", "site.css"), "body{}");
    git(root, "add", ".");
    git(root, "commit", "-qm", "base");
    const first = sourceManifestFromGit(root, "HEAD");
    const second = sourceManifestFromGit(root, git(root, "rev-parse", "HEAD"));
    assert.deepEqual(first, second);
    assert.equal(first.count, 2);
    await writeFile(path.join(root, "index.html"), "second");
    git(root, "add", "index.html");
    git(root, "commit", "-qm", "mutation");
    const mutated = sourceManifestFromGit(root, "HEAD");
    assert.notEqual(mutated.sha256, first.sha256);
  });
});

test("source manifest rejects symbolic-link and gitlink modes", async () => {
  await withGitRepository(async (root) => {
    await writeFile(path.join(root, "target.txt"), "target");
    await symlink("target.txt", path.join(root, "link.txt"));
    git(root, "add", ".");
    git(root, "commit", "-qm", "symlink");
    assert.throws(() => sourceManifestFromGit(root, "HEAD"), /forbidden blob or mode 120000/u);
  });
});

test("gitDiffPaths reports exact paths without rename folding", async () => {
  await withGitRepository(async (root) => {
    await writeFile(path.join(root, "a.txt"), "a");
    git(root, "add", ".");
    git(root, "commit", "-qm", "base");
    const base = git(root, "rev-parse", "HEAD");
    await writeFile(path.join(root, "a.txt"), "b");
    await writeFile(path.join(root, "z.txt"), "z");
    git(root, "add", ".");
    git(root, "commit", "-qm", "candidate");
    assert.deepEqual(gitDiffPaths(root, base, git(root, "rev-parse", "HEAD")), ["a.txt", "z.txt"]);
  });
});

test("artifact manifest is deterministic for ordinary public files", async () => {
  await withArtifact({ "index.html": "safe", "assets/site.css": "body{}" }, async (root) => {
    const first = await artifactManifest(root);
    const second = await artifactManifest(root);
    assert.deepEqual(first, second);
    assert.equal(first.count, 2);
  });
});

test("postdeploy production proof accepts propagation delay only after two full exact snapshots", async () => {
  assert.equal(POSTDEPLOY_REQUEST_CONCURRENCY, 8);
  const files = productionFiles();
  const manifest = artifactManifestFor(files);
  let phase = 0;
  let clock = 0;
  const { fetchImpl, requests } = liveFixtureFetch(files, ({ bytes, file, status }) => (
    phase === 0 && file === "index.html"
      ? { bytes: Buffer.from("stale predecessor"), status }
      : { bytes, status }
  ));
  const result = await pollLiveProduction({
    manifest,
    origin: "https://production.example",
    fetchImpl,
    now: () => clock,
    sleep: async (milliseconds) => {
      clock += milliseconds;
      phase += 1;
    },
    propagationWindowMs: 100,
    pollIntervalMs: 10,
    requestTimeoutMs: 1000,
  });
  assert.equal(result.attempts.length, 4);
  assert.equal(result.attempts[0].full, true);
  assert.deepEqual(result.attempts[0].mismatchKeys, ["artifact:index.html"]);
  assert.equal(result.attempts[1].full, false);
  assert.equal(result.attempts[2].full, true);
  assert.equal(result.attempts[3].full, true);
  assert.equal(result.consecutiveExactFullSnapshots, 2);
  assert.equal(result.finalSnapshot.exact, true);
  assert.ok(requests.length > manifest.count * 2);
});

test("postdeploy production proof catches an intermittently stale edge after an exact snapshot", async () => {
  const files = productionFiles();
  const manifest = artifactManifestFor(files);
  let phase = 0;
  let clock = 0;
  const { fetchImpl } = liveFixtureFetch(files, ({ bytes, file, status }) => (
    phase === 1 && file === "index.html"
      ? { bytes: Buffer.from("intermittent stale edge"), status }
      : { bytes, status }
  ));
  const result = await pollLiveProduction({
    manifest,
    origin: "https://production.example",
    fetchImpl,
    now: () => clock,
    sleep: async (milliseconds) => {
      clock += milliseconds;
      phase += 1;
    },
    propagationWindowMs: 100,
    pollIntervalMs: 10,
    requestTimeoutMs: 1000,
  });
  assert.equal(result.attempts.length, 5);
  assert.equal(result.attempts[0].exactCount, result.finalSnapshot.totalResourceCount);
  assert.deepEqual(result.attempts[1].mismatchKeys, ["artifact:index.html"]);
  assert.equal(result.attempts[2].full, false);
  assert.equal(result.attempts[3].full, true);
  assert.equal(result.attempts[4].full, true);
});

test("postdeploy live snapshot reports mismatched bytes with digest and status evidence", async () => {
  const files = productionFiles({ "vnext.css": "reviewed bytes" });
  const manifest = artifactManifestFor(files);
  const { fetchImpl, requests } = liveFixtureFetch(files, ({ bytes, file, status }) => (
    file === "vnext.css"
      ? { bytes: Buffer.from("mutated bytes"), status }
      : { bytes, status }
  ));
  const snapshot = await inspectLiveProductionSnapshot({
    manifest,
    origin: "https://production.example",
    fetchImpl,
    requestTimeoutMs: 1000,
  });
  const mismatch = snapshot.resources.find((resource) => resource.key === "artifact:vnext.css");
  assert.equal(snapshot.exact, false);
  assert.equal(mismatch.status, 200);
  assert.equal(mismatch.expectedSha256, sha256("reviewed bytes"));
  assert.equal(mismatch.actualSha256, sha256("mutated bytes"));
  assert.ok(mismatch.failures.includes("SHA-256 mismatch"));
  assert.deepEqual(new Set(requests.map(({ options }) => options.method)), new Set(["GET", "HEAD"]));
  assert.ok(requests.every(({ options }) => options.body === undefined));
  assert.equal(validateArtifactManifestShape(manifest), manifest);
});

test("postdeploy live snapshot fails closed when HEAD and GET disagree", async () => {
  const files = productionFiles();
  const manifest = artifactManifestFor(files);
  const { fetchImpl } = liveFixtureFetch(files, ({ bytes, file, method, status }) => (
    file === "index.html" && method === "HEAD"
      ? { bytes, status: 503 }
      : { bytes, status }
  ));
  const snapshot = await inspectLiveProductionSnapshot({
    manifest,
    origin: "https://production.example",
    fetchImpl,
    requestTimeoutMs: 1000,
  });
  const mismatch = snapshot.resources.find((resource) => resource.key === "artifact:index.html");
  assert.equal(mismatch.status, 200);
  assert.equal(mismatch.headStatus, 503);
  assert.equal(mismatch.exact, false);
  assert.ok(mismatch.failures.includes("HEAD status 503 != 200"));
});

test("postdeploy live snapshot rejects a missing canonical route", async () => {
  const files = productionFiles();
  const manifest = artifactManifestFor(files);
  const { fetchImpl } = liveFixtureFetch(files, ({ bytes, pathname, status }) => (
    pathname === "/contact/"
      ? { bytes: Buffer.from(files["404.html"]), status: 404 }
      : { bytes, status }
  ));
  const snapshot = await inspectLiveProductionSnapshot({
    manifest,
    origin: "https://production.example",
    fetchImpl,
    requestTimeoutMs: 1000,
  });
  const missing = snapshot.resources.find((resource) => resource.key === "artifact:contact/index.html");
  assert.equal(missing.status, 404);
  assert.equal(missing.expectedStatus, 200);
  assert.equal(missing.exact, false);
  assert.ok(missing.failures.some((failure) => failure.includes("status 404 != 200")));

  const incomplete = productionFiles();
  delete incomplete["contact/index.html"];
  assert.throws(
    () => validateProductionRouteManifest(artifactManifestFor(incomplete)),
    /missing canonical route \/contact\//u,
  );
});

test("postdeploy route fixture proves canonical pages, custom 404, redirects, and source-only absence", async () => {
  const files = productionFiles();
  const manifest = artifactManifestFor(files);
  const { fetchImpl } = liveFixtureFetch(files);
  const snapshot = await inspectLiveProductionSnapshot({
    manifest,
    origin: PRODUCTION_ORIGIN,
    fetchImpl,
    requestTimeoutMs: 1000,
  });
  await withArtifact(files, async (artifactRoot) => {
    const contract = await verifyProductionRouteContract({
      artifactRoot,
      manifest,
      finalSnapshot: snapshot,
    });
    assert.deepEqual(contract.canonicalRoutes, Object.keys(PRODUCTION_CANONICAL_ROUTE_FILES));
    assert.deepEqual(
      contract.legacyRedirects,
      Object.keys(PRODUCTION_LEGACY_REDIRECTS).filter((file) => file !== SOURCE_ONLY_LEGACY_REDIRECT),
    );
    assert.equal(contract.sourceOnlyRedirectAbsence, SOURCE_ONLY_LEGACY_REDIRECT);
    assert.match(contract.custom404Path, /^\/sitesourcery-production-proof-/u);
  });
});

test("real reviewed 75-file artifact satisfies the production manifest and byte-level route contract", async () => {
  const files = reviewedArtifactFiles();
  const manifest = artifactManifestFor(files);
  assert.equal(manifest.count, REVIEWED_PUBLIC_ARTIFACT_PATHS.length);
  assert.equal(manifest.count, 75);
  assert.equal(validateProductionRouteManifest(manifest), manifest);

  const { fetchImpl } = liveFixtureFetch(files);
  const snapshot = await inspectLiveProductionSnapshot({
    manifest,
    origin: PRODUCTION_ORIGIN,
    fetchImpl,
    requestTimeoutMs: 1000,
  });
  assert.equal(snapshot.full, true);
  assert.equal(snapshot.exact, true);

  await withArtifact(files, async (artifactRoot) => {
    const contract = await verifyProductionRouteContract({
      artifactRoot,
      manifest,
      finalSnapshot: snapshot,
    });
    assert.deepEqual(contract.canonicalRoutes, Object.keys(PRODUCTION_CANONICAL_ROUTE_FILES));
    assert.deepEqual(
      contract.legacyRedirects,
      Object.keys(PRODUCTION_LEGACY_REDIRECTS).filter((file) => file !== SOURCE_ONLY_LEGACY_REDIRECT),
    );
    assert.equal(contract.sourceOnlyRedirectAbsence, "thanks.html");
  });
});

test("postdeploy proof rejects Web3Forms, access_key, and the retired 321 identity", async () => {
  const forbidden = [
    "Web3Forms",
    'name="access_key"',
    "tel:+13217882555",
  ].join(" ");
  assert.deepEqual(
    forbiddenPublicMarkers("index.html", Buffer.from(forbidden)),
    ["Web3Forms", "access_key", "retired 321 identity"],
  );
  assert.deepEqual(
    forbiddenPublicMarkers(
      "index.html",
      Buffer.from("A keyboard access key and reference 932178825550 are harmless prose."),
    ),
    [],
  );
  await withReviewedArtifact({ "index.html": forbidden }, async (root, files) => {
    await assert.rejects(
      () => validateArtifactSafety(root, manifestFor(files)),
      /forbidden public markers/u,
    );
  });
  const files = productionFiles({ "index.html": forbidden });
  const manifest = artifactManifestFor(files);
  const { fetchImpl } = liveFixtureFetch(files);
  const snapshot = await inspectLiveProductionSnapshot({
    manifest,
    origin: "https://production.example",
    fetchImpl,
    requestTimeoutMs: 1000,
  });
  assert.deepEqual(snapshot.forbidden, [
    "/: Web3Forms",
    "/: access_key",
    "/: retired 321 identity",
  ]);
  let clock = 0;
  await assert.rejects(
    () => pollLiveProduction({
      manifest,
      origin: "https://production.example",
      fetchImpl,
      now: () => clock,
      sleep: async (milliseconds) => {
        clock += milliseconds;
      },
      propagationWindowMs: 100,
      pollIntervalMs: 10,
      requestTimeoutMs: 1000,
    }),
    /propagation timed out.*forbidden markers/u,
  );
});

test("postdeploy proof permits a forbidden predecessor only while bounded propagation continues", async () => {
  const files = productionFiles();
  const manifest = artifactManifestFor(files);
  let phase = 0;
  let clock = 0;
  const stale = Buffer.from('<form action="https://api.web3forms.com/submit"><input name="access_key"></form>');
  const { fetchImpl } = liveFixtureFetch(files, ({ bytes, file, method, status }) => (
    phase === 0 && method === "GET" && file === "index.html"
      ? { bytes: stale, status }
      : { bytes, status }
  ));
  const result = await pollLiveProduction({
    manifest,
    origin: "https://production.example",
    fetchImpl,
    now: () => clock,
    sleep: async (milliseconds) => {
      clock += milliseconds;
      phase += 1;
    },
    propagationWindowMs: 100,
    pollIntervalMs: 10,
    requestTimeoutMs: 1000,
  });
  assert.deepEqual(result.attempts[0].forbidden, [
    "/: Web3Forms",
    "/: access_key",
  ]);
  assert.equal(result.finalSnapshot.forbidden.length, 0);
  assert.equal(result.consecutiveExactFullSnapshots, POSTDEPLOY_REQUIRED_EXACT_SNAPSHOTS);
});

test("postdeploy proof fails closed at the deterministic propagation timeout", async () => {
  const files = productionFiles();
  const manifest = artifactManifestFor(files);
  let clock = 0;
  const { fetchImpl } = liveFixtureFetch(files, ({ bytes, file, status }) => (
    file === "index.html"
      ? { bytes: Buffer.from("permanently stale"), status }
      : { bytes, status }
  ));
  await assert.rejects(
    () => pollLiveProduction({
      manifest,
      origin: "https://production.example",
      fetchImpl,
      now: () => clock,
      sleep: async (milliseconds) => {
        clock += milliseconds;
      },
      propagationWindowMs: 25,
      pollIntervalMs: 10,
      requestTimeoutMs: 1000,
    }),
    (error) => (
      error instanceof PublicTruthVerificationError
      && /propagation timed out/u.test(error.message)
      && error.postdeployEvidence?.attempts.length === 4
      && error.postdeployEvidence?.completedAtMs === 25
    ),
  );
});

test("postdeploy identity rejects candidate, control, artifact, and deployment confusion", () => {
  const controlSha = "89abcdef".repeat(5);
  const identity = {
    actor: "Founder-Test",
    actorId: "987654",
    artifactFileCount: REVIEWED_PUBLIC_ARTIFACT_PATHS.length,
    artifactId: "123456789",
    artifactManifestSha256: ARTIFACT_MANIFEST_SHA,
    candidateSha: CANDIDATE_SHA,
    controlSha,
    deploymentPageUrl: "https://sitesourcery.com/",
    deploymentStatus: "success",
    origin: PRODUCTION_ORIGIN,
    pagesDeploymentBuildVersion: controlSha,
    pagesDeploymentStatus: "succeed",
    pagesDeploymentUrl: `https://api.github.com/repos/${REPOSITORY_FULL_NAME}/pages/deployments/${controlSha}`,
    repository: REPOSITORY_FULL_NAME,
    repositoryId: "123456",
    runAttempt: "1",
    runId: "24681012",
    sourceManifestSha256: SOURCE_MANIFEST_SHA,
    workflowSha: controlSha,
  };
  assert.equal(validatePostdeployIdentity(identity).controlSha, controlSha);
  assert.deepEqual(
    validatePagesDeploymentObservation({ status: "succeed" }, controlSha),
    { buildVersion: controlSha, status: "succeed" },
  );
  assert.equal(normalizeLiveOrigin("https://sitesourcery.com/"), PRODUCTION_ORIGIN);
  for (const [field, value, expected] of [
    ["candidateSha", controlSha, /candidate and control identities must remain distinct/u],
    ["workflowSha", CANDIDATE_SHA, /workflow SHA/u],
    ["pagesDeploymentBuildVersion", CANDIDATE_SHA, /Pages deployment build version/u],
    ["artifactId", CANDIDATE_SHA, /artifact ID/u],
    ["deploymentPageUrl", "https://attacker.example/", /deployed Pages URL/u],
    ["pagesDeploymentStatus", "pending", /observation status/u],
  ]) {
    assert.throws(
      () => validatePostdeployIdentity({ ...identity, [field]: value }),
      expected,
      field,
    );
  }
  assert.throws(
    () => validatePagesDeploymentObservation({ status: "pending" }, controlSha),
    /Pages deployment status/u,
  );
});

test("artifact safety accepts exact static projection with open direct-inquiry guides", async () => {
  const guide = [
    '<article data-intake-state="open">',
    "<h1>Static conversation guide</h1>",
    '<a href="tel:+18562441220">Call</a>',
    '<a href="mailto:sitesourcery@proton.me?subject=Scope">Email</a>',
    "</article>",
  ].join("");
  await withReviewedArtifact({
    "contact/index.html": guide,
    "start/index.html": guide,
  }, async (root, files) => {
    const source = manifestFor({ ...files, "scripts/build.mjs": "private" });
    const result = await validateArtifactSafety(root, source);
    assert.equal(result.count, REVIEWED_PUBLIC_ARTIFACT_PATHS.length);
  });
});

test("artifact projection ignores source-only legacy bytes and rejects them in the artifact", async () => {
  const sourceOnlyFiles = Object.fromEntries(
    LEGACY_SOURCE_ONLY_ARTIFACT_PATHS.map((file) => [file, `source-only:${file}`]),
  );
  await withReviewedArtifact({}, async (root, files) => {
    const result = await validateArtifactSafety(
      root,
      manifestFor({ ...files, ...sourceOnlyFiles }),
    );
    assert.equal(result.count, REVIEWED_PUBLIC_ARTIFACT_PATHS.length);
    assert.deepEqual(
      result.entries.map((entry) => entry.path),
      REVIEWED_PUBLIC_ARTIFACT_PATHS,
    );
  });
  await withReviewedArtifact(sourceOnlyFiles, async (root, files) => {
    await assert.rejects(
      () => validateArtifactSafety(root, manifestFor(files)),
      (error) => {
        assert.match(error.message, /artifact is not the exact candidate projection/u);
        for (const file of LEGACY_SOURCE_ONLY_ARTIFACT_PATHS) {
          assert.match(error.message, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
        }
        return true;
      },
    );
  });
});

test("artifact projection fails closed when source-only bytes replace one reviewed path", async () => {
  await withReviewedArtifact({}, async (root, files) => {
    const substituted = {
      ...files,
      "thanks.html": "source-only replacement attempt",
    };
    delete substituted[".nojekyll"];
    await assert.rejects(
      () => validateArtifactSafety(root, manifestFor(substituted)),
      /source manifest is missing reviewed public artifact path \.nojekyll/u,
    );
  });
});

test("current contact guide and Start redirect bytes satisfy the artifact contract", async () => {
  await withReviewedArtifact({}, async (root, files) => {
    const result = await validateArtifactSafety(root, manifestFor(files));
    assert.equal(result.count, REVIEWED_PUBLIC_ARTIFACT_PATHS.length);
  });
});

test("artifact safety permits an exact held form only outside the zero-entry guide routes", async () => {
  const html = [
    '<form data-commercial-state="hold" data-no-entry="true" onsubmit="return false" aria-disabled="true">',
    '<fieldset data-no-entry-barrier="true" disabled aria-disabled="true">',
    '<input name="preview"><button type="submit" disabled>Held</button>',
    "</fieldset></form>",
  ].join("");
  await withReviewedArtifact({ "index.html": html }, async (root, files) => {
    const result = await validateArtifactSafety(root, manifestFor(files));
    assert.equal(result.count, REVIEWED_PUBLIC_ARTIFACT_PATHS.length);
  });
});

test("artifact safety rejects even fully disabled forms on the direct-inquiry contact guide", async () => {
  const disabledForm = [
    '<article data-intake-state="open">',
    '<a href="tel:+18562441220">Call</a>',
    '<a href="mailto:sitesourcery@proton.me">Email</a>',
    '<form data-commercial-state="hold" data-no-entry="true" onsubmit="return false" aria-disabled="true">',
    '<fieldset data-no-entry-barrier="true" disabled aria-disabled="true">',
    '<input name="preview"><button type="submit" disabled>Held</button>',
    "</fieldset></form></article>",
  ].join("");
  for (const file of ["contact/index.html"]) {
    await withReviewedArtifact({ [file]: disabledForm }, async (root, files) => {
      await assert.rejects(
        () => validateArtifactSafety(root, manifestFor(files)),
        /direct-inquiry guide contains forbidden <form>/u,
        file,
      );
    });
  }
});

test("direct-inquiry guides require open-intake markers, direct routes, and no editable or submit surface", async () => {
  const valid = [
    '<article data-intake-state="open">',
    '<a href="tel:+18562441220">Call</a>',
    '<a href="mailto:sitesourcery@proton.me">Email</a>',
    "</article>",
  ].join("");
  const mutations = [
    [valid.replace(' data-intake-state="open"', ""), /open-intake boundary/u],
    [valid.replace("tel:+18562441220", "tel:+18565550100"), /public call route/u],
    [valid.replace("mailto:sitesourcery@proton.me", "mailto:other@example.invalid"), /studio email/u],
    [valid.replace("</article>", '<p contenteditable="false">Draft</p></article>'), /contenteditable|editable public input surface/u],
    [valid.replace("</article>", '<button type="submit">Send</button></article>'), /submit control/u],
    [valid.replace("</article>", "<select><option>Draft</option></select></article>"), /forbidden <select>/u],
    [valid.replace("</article>", "<textarea>Draft</textarea></article>"), /forbidden <textarea>/u],
  ];
  for (const [html, expected] of mutations) {
    await withReviewedArtifact({ "contact/index.html": html }, async (root, files) => {
      await assert.rejects(() => validateArtifactSafety(root, manifestFor(files)), expected);
    });
  }
});

test("artifact safety rejects content and manifest mutation", async () => {
  await withReviewedArtifact({ "index.html": "mutated" }, async (root) => {
    const source = manifestFor(reviewedArtifactFiles({ "index.html": "reviewed" }));
    await assert.rejects(() => validateArtifactSafety(root, source), /exact candidate projection/u);
  });
  await withReviewedArtifact({ "extra.html": "extra" }, async (root) => {
    const source = manifestFor(reviewedArtifactFiles());
    await assert.rejects(() => validateArtifactSafety(root, source), /extra: extra\.html/u);
  });
});

test("artifact safety rejects print, governance, development, and private leakage", async () => {
  for (const file of [
    "print-collateral/card.pdf",
    ".github/workflows/deploy.yml",
    "scripts/build.mjs",
    "data/release-control.json",
    ".env.production",
    "assets/signing-key.pem",
  ]) {
    await withReviewedArtifact({ [file]: "private" }, async (root, files) => {
      const source = manifestFor(files);
      await assert.rejects(() => validateArtifactSafety(root, source), /development, governance, or private path|exact candidate projection/u, file);
    });
  }
});

test("artifact safety rejects active, malformed, or partially enabled forms", async () => {
  const forms = [
    '<form action="https://example.invalid"><button type="submit">Send</button></form>',
    '<form data-commercial-state="hold" data-no-entry="true" onsubmit="return false" aria-disabled="true"><input><fieldset data-no-entry-barrier="true" disabled aria-disabled="true"></fieldset></form>',
    '<form data-commercial-state="hold" data-no-entry="true" onsubmit="return false" aria-disabled="true"><fieldset data-no-entry-barrier="true" aria-disabled="true"><button type="submit">Send</button></fieldset></form>',
    '<form data-commercial-state="hold" data-no-entry="true" onsubmit="return false" aria-disabled="true"><fieldset data-no-entry-barrier="true" disabled aria-disabled="true"><button type="submit">Send</button></fieldset></form>',
  ];
  for (const html of forms) {
    await withReviewedArtifact({ "index.html": html }, async (root, files) => {
      await assert.rejects(() => validateArtifactSafety(root, manifestFor(files)), /form|submit/u);
    });
  }
});

test("artifact safety rejects payment endpoints and browser network sinks", async () => {
  const payment = '<a href="https://buy.stripe.com/example">Pay</a>';
  await withReviewedArtifact({ "index.html": payment }, async (root, files) => {
    await assert.rejects(() => validateArtifactSafety(root, manifestFor(files)), /payment-provider/u);
  });
  const localCheckout = '<a href="/checkout/">Order</a>';
  await withReviewedArtifact({ "index.html": localCheckout }, async (root, files) => {
    await assert.rejects(() => validateArtifactSafety(root, manifestFor(files)), /payment or ordering route/u);
  });
  const network = "fetch('/collect')";
  await withReviewedArtifact({ "sourcery.js": network }, async (root, files) => {
    await assert.rejects(() => validateArtifactSafety(root, manifestFor(files)), /network sink/u);
  });
  const enable = 'button.removeAttribute("disabled")';
  await withReviewedArtifact({ "sourcery.js": enable }, async (root, files) => {
    await assert.rejects(() => validateArtifactSafety(root, manifestFor(files)), /enable or submit/u);
  });
  const changedReviewedControl = `${
    REVIEWED_ARTIFACT_FILES["abracadabra/app/abracadabra-app.js"]
  }\nbutton.disabled = false;\n`;
  await withReviewedArtifact({
    "abracadabra/app/abracadabra-app.js": changedReviewedControl,
  }, async (root, files) => {
    await assert.rejects(
      () => validateArtifactSafety(root, manifestFor(files)),
      /enable or submit/u,
    );
  });
  const inlineNetwork = "<script>navigator.sendBeacon('/collect')</script>";
  await withReviewedArtifact({ "index.html": inlineNetwork }, async (root, files) => {
    await assert.rejects(() => validateArtifactSafety(root, manifestFor(files)), /inline browser network sink/u);
  });
});

test("artifact safety permits only the exact reviewed user-triggered Cloudflare NS preflight", async () => {
  const file = "domains/domain-search.js";
  const reviewed = REVIEWED_ARTIFACT_FILES[file].toString("utf8");
  assert.equal(sha256(Buffer.from(reviewed)), REVIEWED_DOMAIN_PREFLIGHT_SHA256);

  const mutations = Object.freeze([
    ["resolver URL", reviewed.replace("https://cloudflare-dns.com/dns-query", "https://resolver.example.invalid/dns-query")],
    ["HTTP method", reviewed.replace('method: "GET"', 'method: "POST"')],
    ["load trigger", reviewed.replace('button.addEventListener("click", run);', 'window.addEventListener("load", run);')],
    ["candidate count", reviewed.replace('["com", "net", "org"]', '["com", "net", "org", "io"]')],
    ["record type", reviewed.replace("&type=NS", "&type=A")],
  ]);
  for (const [label, mutation] of mutations) {
    assert.notEqual(mutation, reviewed, `${label} fixture must mutate the reviewed source`);
    await withReviewedArtifact({ [file]: mutation }, async (root, files) => {
      await assert.rejects(
        () => validateArtifactSafety(root, manifestFor(files)),
        /reviewed DNS preflight/u,
        label,
      );
    });
  }

  await withReviewedArtifact({ "vnext.js": 'fetch("https://cloudflare-dns.com/dns-query?name=example.com&type=NS", { method: "GET" });' }, async (root, files) => {
    await assert.rejects(
      () => validateArtifactSafety(root, manifestFor(files)),
      /active browser network sink/u,
    );
  });
});

test("artifact manifest rejects symbolic links", async () => {
  const scratch = await mkdtemp(path.join(tmpdir(), "public-truth-artifact-link-test-"));
  try {
    await writeFile(path.join(scratch, "target.txt"), "target");
    await symlink("target.txt", path.join(scratch, "link.txt"));
    await assert.rejects(() => artifactManifest(scratch), /symbolic link/u);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("verifier module has no placeholder authority or OG digest", async () => {
  const source = await readFile(path.join(PROJECT_ROOT, "scripts/verify-public-truth-release.mjs"), "utf8");
  assert.doesNotMatch(source, /__SET_AFTER|TODO_AUTHORITY|PLACEHOLDER_HASH/u);
  assert.equal((source.match(/method: "GET"/gu) ?? []).length >= 2, true);
  assert.equal((source.match(/method: "HEAD"/gu) ?? []).length, 1);
  assert.doesNotMatch(source, /method:\s*"POST"/u);
  assert.match(OG_SOURCE_SHA256, /^[0-9a-f]{64}$/u);
  assert.match(OG_PNG_SHA256, /^[0-9a-f]{64}$/u);
});

test("CLI denies a bare invocation before touching release state", async () => {
  await assert.rejects(
    () => runCli([], {}),
    /--mode must be exactly candidate, control, predeploy, or postdeploy/u,
  );
});

test("errors use the dedicated fail-closed verification type", () => {
  assert.throws(
    () => parseCli(["--mode", "anything"]),
    (error) => (
      error instanceof PublicTruthVerificationError
      && /candidate, control, predeploy, or postdeploy/u.test(error.message)
    ),
  );
});
