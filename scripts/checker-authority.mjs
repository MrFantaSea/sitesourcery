#!/usr/bin/env node

/**
 * Machine-checked authority ledger for the retired vNext inspector.
 *
 * Every rule family called by validateSiteVnext is accounted for exactly once.
 * "current" means an existing release gate already owns the risk, "ported"
 * means this cleanup moved the still-valid invariant into a current gate, and
 * "retired" means the rule froze an obsolete route, product, copy, or CSS
 * implementation rather than a current customer/business risk.
 */

import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ARCHIVED_CHECKER = "scripts/check-site-vnext.mjs";
const ARCHIVED_TEST = "scripts/test/site-vnext.test.mjs";
const ARCHIVED_ABRACADABRA_CHECKER = "scripts/check-abracadabra-v1.mjs";

function entry(id, disposition, legacyCalls, authorities, decision) {
  return Object.freeze({
    id,
    disposition,
    legacyCalls: Object.freeze(legacyCalls),
    authorities: Object.freeze(authorities),
    decision,
  });
}

export const LEGACY_VNEXT_RULE_INVENTORY = Object.freeze([
  entry(
    "route-and-artifact-integrity",
    "current",
    ["validateRouteContract", "checkPublicAllowlist", "compareArtifact"],
    ["scripts/check-site.mjs", "scripts/build-pages.mjs"],
    "Current gates derive routes and artifacts from the positive public-file ledger, verify links, redirects, canonicals, sitemap membership, and byte-for-byte artifact output.",
  ),
  entry(
    "public-contact-identity",
    "current",
    ["checkContactTruth", "checkCanonicalPublicEmail"],
    ["scripts/check-site.mjs"],
    "The current site gate rejects alternate phone and email values on every public page without requiring retired seller-copy strings in every footer.",
  ),
  entry(
    "document-and-404-semantics",
    "ported",
    ["checkMainFocusTarget", "check404"],
    ["scripts/check-site.mjs"],
    "The current site gate now requires one h1 and a focusable #main on every live page plus noindex on 404.html.",
  ),
  entry(
    "public-source-and-transaction-boundaries",
    "current",
    ["checkPublicSource"],
    [
      "scripts/check-site.mjs",
      "scripts/test/domain-public-truth.test.mjs",
      "scripts/test/hosted-artifact.test.mjs",
    ],
    "Current gates reject forms, unapproved external destinations, unregistered checkout rails, and held executable semantics while allowing reviewed same-origin application behavior.",
  ),
  entry(
    "resource-closure",
    "current",
    ["checkEmbeddedStyles", "checkCssReferences", "checkSvgReferences"],
    ["scripts/check-site.mjs", "scripts/build-pages.mjs", "scripts/browser-audit-current.mjs"],
    "The public-file ledger, source resource checks, exact artifact build, and current browser traversal replace the retired parser-specific CSS/SVG implementation.",
  ),
  entry(
    "work-public-truth",
    "ported",
    ["checkWorkExternalProof", "checkCustomerEvidence", "checkTargetCustomerClaims"],
    [
      "scripts/work-public-truth.mjs",
      "scripts/check-site.mjs",
      "scripts/test/work-public-truth.test.mjs",
    ],
    "A focused current invariant proves exactly two named founder-owned ventures, exactly two explicitly fictional studies, their non-client labels, and no invented client-result claim without freezing Work layout or prose.",
  ),
  entry(
    "legal-and-public-truth",
    "current",
    ["checkInformationWayfinding", "checkPublicTruthCoherence", "checkBusinessEmailCoherence"],
    [
      "scripts/check-legal-copy.mjs",
      "scripts/legal-section-ids.mjs",
      "scripts/check-site.mjs",
      "scripts/test/domain-public-truth.test.mjs",
    ],
    "Stable legal anchors and clauses are in the current legal gate; sealed hosted truth and domain tests own release/custody truth. Retired route-specific marketing sentences are not copied forward.",
  ),
  entry(
    "custom-service-commercial-truth",
    "current",
    ["checkCustomCatalogSurface", "checkCustomProcess", "checkPaidRouteSectionContracts"],
    [
      "scripts/check-pricing.mjs",
      "scripts/test/custom-services-catalog.test.mjs",
      "scripts/test/abracadabra-custom-services-owner.test.mjs",
    ],
    "Catalog, quote, payment-boundary, and owner-projection tests replace exact retired marketing-section and route markers.",
  ),
  entry(
    "abracadabra-product-truth",
    "current",
    ["checkAbracadabraProductCoherence", "checkAbracadabraShowcaseCopy"],
    [
      "scripts/test/abracadabra-v1.test.mjs",
      "scripts/test/abracadabra-commercial-control.test.mjs",
      "scripts/test/abracadabra-hosted-control.test.mjs",
    ],
    "Current product/runtime, commercial-control, and hosted-control tests own Abracadabra behavior; obsolete six-step and exact-copy assertions do not.",
  ),
  entry(
    "release-hold-truth",
    "current",
    ["checkReleaseControl"],
    [
      "scripts/check-site.mjs",
      "scripts/test/domain-public-truth.test.mjs",
      "scripts/test/abracadabra-hosted-control.test.mjs",
    ],
    "Current commerce availability, domain public-truth, and hosted-control tests fail closed around held deployment and checkout authority.",
  ),
  entry(
    "retired-exact-information-architecture",
    "retired",
    [
      "checkHomeDoors",
      "checkHiveCells",
      "checkSolutionAnchors",
      "checkStartPaths",
      "checkStartDecisionLogic",
      "checkAboutTrust",
      "checkCustomerSections",
      "checkIntakeCongruence",
    ],
    ["scripts/check-site.mjs", "scripts/browser-audit-current.mjs"],
    "These rules require removed routes, old nav labels, the former Hive/Start model, and exact marketing section order. Current link/nav/browser gates retain navigability without restoring obsolete architecture.",
  ),
  entry(
    "retired-css-string-heuristics",
    "retired",
    ["checkCssTypeFloor", "checkStartMotionContract", "checkContactSelectionContract"],
    ["scripts/browser-audit-current.mjs"],
    "The regex-only 12px and exact CSS-string rules reject the accepted current design and cannot compute rendered CSS. The current width sweep owns actual usability and overflow.",
  ),
]);

function assumption(id, evidence, authorities, decision) {
  return Object.freeze({
    id,
    disposition: "retired",
    evidence: Object.freeze(evidence),
    authorities: Object.freeze(authorities),
    decision,
  });
}

/** Five known stale assumptions in the separate Spark V1 source inspector. */
export const ABRACADABRA_V1_STALE_ASSUMPTION_INVENTORY = Object.freeze([
  assumption(
    "spark-v1-exact-seller-legend",
    [
      "exact legal-seller legend is missing",
      "Site Sourcery is the brand presentation of the filed alternate name SITESOURCERY.",
    ],
    ["scripts/check-legal-copy.mjs", "scripts/check-site.mjs"],
    "Legacy-only exact footer sentence. Current legal pages retain exact seller identity while ordinary pages use the approved current footer and canonical contact identity.",
  ),
  assumption(
    "spark-v1-purchase-word-ban",
    ["purchase or instant-publication claim", "buy now|order now|live in minutes"],
    [
      "scripts/check-site.mjs",
      "scripts/test/abracadabra-commercial-control.test.mjs",
      "scripts/test/abracadabra-hosted-control.test.mjs",
    ],
    "Legacy-only lexical ban: current account-aware purchase language is intentional. Current offer classification and hosted-control tests keep public checkout, hosting activation, and publication held.",
  ),
  assumption(
    "spark-v1-single-amount-scan",
    ["publicAmounts.length === 1", "accepted one-time $5 Download amount"],
    [
      "scripts/check-site.mjs",
      "scripts/test/abracadabra-hosted-control.test.mjs",
      "server/commerce/test/offer-contract.test.mjs",
    ],
    "Legacy-only whole-page dollar-count heuristic. Current catalog/rail checks and server-quote tests bind the Download to exactly 500 USD minor units without rejecting other truthful amounts.",
  ),
  assumption(
    "spark-v1-session-storage-ban",
    ['[/\\bsessionStorage\\b/u, "sessionStorage"]'],
    [
      "scripts/test/abracadabra-v1.test.mjs",
      "scripts/test/abracadabra-hosted-control.test.mjs",
    ],
    "Legacy-only blanket storage ban. Reviewed session-scoped state is now intentional and mutation-tested; it grants no deployment, publication, or checkout authority.",
  ),
  assumption(
    "spark-v1-preview-srcdoc-marker",
    ['"preview.srcdoc"'],
    ["scripts/test/abracadabra-v1.test.mjs", "scripts/browser-audit-current.mjs"],
    "Legacy-only implementation marker. Current behavior tests and browser traversal own sandboxed preview rendering, independent of whether the renderer assigns srcdoc directly.",
  ),
]);

const lexical = (left, right) => left < right ? -1 : left > right ? 1 : 0;

export function legacyValidationCalls(source) {
  const start = source.indexOf("export async function validateSiteVnext");
  const end = source.indexOf("export async function runSiteVnextCli", start);
  if (start < 0 || end < 0) return [];
  const body = source.slice(start, end);
  return [...new Set(
    [...body.matchAll(/\b((?:check|compare|validate)[A-Z0-9][A-Za-z0-9]*)\s*\(/gu)]
      .map((match) => match[1])
      .filter((name) => name !== "validateSiteVnext"),
  )].sort(lexical);
}

export function validateInventoryParity(legacySource) {
  const errors = [];
  const inventoried = LEGACY_VNEXT_RULE_INVENTORY
    .flatMap(({ legacyCalls }) => legacyCalls)
    .sort(lexical);
  const duplicates = inventoried.filter((name, index) => inventoried.indexOf(name) !== index);
  if (duplicates.length) errors.push(`legacy calls inventoried more than once: ${[...new Set(duplicates)].join(", ")}`);
  const actual = legacyValidationCalls(legacySource);
  const missing = actual.filter((name) => !inventoried.includes(name));
  const absent = inventoried.filter((name) => !actual.includes(name));
  if (missing.length) errors.push(`legacy validation calls missing from inventory: ${missing.join(", ")}`);
  if (absent.length) errors.push(`inventory calls absent from legacy validation: ${absent.join(", ")}`);
  return errors;
}

export async function validateCheckerAuthority(root = ROOT) {
  const errors = [];
  const ids = new Set();
  for (const item of LEGACY_VNEXT_RULE_INVENTORY) {
    if (ids.has(item.id)) errors.push(`duplicate inventory id ${item.id}`);
    ids.add(item.id);
    if (!["current", "ported", "retired"].includes(item.disposition)) {
      errors.push(`${item.id} has invalid disposition ${item.disposition}`);
    }
    if (!item.legacyCalls.length || !item.authorities.length || !item.decision.trim()) {
      errors.push(`${item.id} must name legacy calls, current authority, and a decision`);
    }
    for (const file of item.authorities) {
      try {
        await access(path.join(root, file));
      } catch {
        errors.push(`${item.id} names missing authority ${file}`);
      }
    }
  }

  const legacySource = await readFile(path.join(root, ARCHIVED_CHECKER), "utf8");
  errors.push(...validateInventoryParity(legacySource));
  if (!legacySource.includes("ARCHIVED VNEXT INSPECTOR — NOT A CURRENT RELEASE GATE")) {
    errors.push(`${ARCHIVED_CHECKER} is missing its retirement banner`);
  }

  const abracadabraSource = await readFile(path.join(root, ARCHIVED_ABRACADABRA_CHECKER), "utf8");
  if (!abracadabraSource.includes("ARCHIVED SPARK V1 INSPECTOR — NOT A CURRENT RELEASE GATE")) {
    errors.push(`${ARCHIVED_ABRACADABRA_CHECKER} is missing its retirement banner`);
  }
  for (const item of ABRACADABRA_V1_STALE_ASSUMPTION_INVENTORY) {
    if (ids.has(item.id)) errors.push(`duplicate inventory id ${item.id}`);
    ids.add(item.id);
    if (!item.evidence.length || !item.authorities.length || !item.decision.trim()) {
      errors.push(`${item.id} must name source evidence, current authority, and a decision`);
    }
    for (const marker of item.evidence) {
      if (!abracadabraSource.includes(marker)) {
        errors.push(`${item.id} evidence disappeared from ${ARCHIVED_ABRACADABRA_CHECKER}: ${marker}`);
      }
    }
    for (const file of item.authorities) {
      try {
        await access(path.join(root, file));
      } catch {
        errors.push(`${item.id} names missing authority ${file}`);
      }
    }
  }

  const packageSource = await readFile(path.join(root, "package.json"), "utf8");
  const packageJson = JSON.parse(packageSource);
  const scripts = packageJson.scripts ?? {};
  for (const retiredName of [
    "check:vnext",
    "check:legacy",
    "check:abracadabra",
    "check:routes",
    "check:sections",
    "check:copy",
  ]) {
    if (Object.hasOwn(scripts, retiredName)) errors.push(`package script ${retiredName} still presents retired authority`);
  }
  for (const [name, command] of Object.entries(scripts)) {
    if (
      command.includes(ARCHIVED_CHECKER)
      || command.includes(ARCHIVED_TEST)
      || command.includes(ARCHIVED_ABRACADABRA_CHECKER)
    ) {
      errors.push(`package script ${name} still executes archived vNext code`);
    }
  }
  for (const required of ["check:authority", "check:catalog", "check:legal-copy", "check:site"]) {
    if (!(scripts.check ?? "").includes(`npm run ${required}`)) {
      errors.push(`package check gate does not run ${required}`);
    }
  }
  for (const required of [
    "scripts/test/checker-authority.test.mjs",
    "scripts/test/work-public-truth.test.mjs",
  ]) {
    if (!(scripts["test:node"] ?? "").includes(required)) {
      errors.push(`test:node does not include ${required}`);
    }
  }
  if (!(scripts.test ?? "").includes("npm run check") || !(scripts.test ?? "").includes("npm run test:node")) {
    errors.push("npm test must execute both check and test:node");
  }

  const currentSite = await readFile(path.join(root, "scripts/check-site.mjs"), "utf8");
  if (!currentSite.includes('from "./work-public-truth.mjs"')) {
    errors.push("current site gate does not import the Work public-truth validator");
  }
  const legalCopy = await readFile(path.join(root, "scripts/check-legal-copy.mjs"), "utf8");
  if (legalCopy.includes('from "./check-site-vnext.mjs"')) {
    errors.push("current legal-copy gate still imports the archived vNext checker");
  }

  return errors;
}

export async function runCheckerAuthorityCli() {
  const errors = await validateCheckerAuthority();
  if (errors.length) {
    console.error(`Checker-authority proof failed (${errors.length}):`);
    for (const error of errors) console.error(`- ${error}`);
    return 1;
  }
  const calls = LEGACY_VNEXT_RULE_INVENTORY.flatMap(({ legacyCalls }) => legacyCalls);
  const counts = Object.fromEntries(
    ["current", "ported", "retired"].map((disposition) => [
      disposition,
      LEGACY_VNEXT_RULE_INVENTORY
        .filter((item) => item.disposition === disposition)
        .reduce((total, item) => total + item.legacyCalls.length, 0),
    ]),
  );
  console.log(
    `Checker authority proved: all ${calls.length} archived vNext rule entry points inventoried `
    + `(${counts.current} current, ${counts.ported} ported, ${counts.retired} retired); `
    + `${ABRACADABRA_V1_STALE_ASSUMPTION_INVENTORY.length} stale Spark V1 assumptions retired; `
    + "no archived checker is an npm gate.",
  );
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runCheckerAuthorityCli();
}
