#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  configureHostedAbracadabraHtml,
  hostedStagingAssets,
} from "./configure-abracadabra-hosted-staging.mjs";
import { publicFileAllowlist } from "./build-pages.mjs";
import {
  heldAlakazamArtifactExcludedFiles,
  heldAlakazamCopyForbiddenSemantics,
  heldAlakazamCopyFragmentSha256,
  heldAlakazamCustomerArtifactFiles,
  heldAlakazamExecutableSemantics,
  heldOnlyPhrases,
  heldTruthForbiddenPhrases,
  heldTruthRequirements,
  hostedCodeTransforms,
  hostedOnlyPhrases,
  hostedStagingAssetSha256,
  hostedTruthRequirements,
  hostedTruthSlots,
} from "./hosted-truth/manifest.mjs";
import {
  assertImmutableLegalArtifactSources,
  assertPrivacyV3CandidateSources,
  assertPrivacyV3NotPublished,
  assertUnsealedPrivacyCurrentAlias,
  HOSTED_PRIVACY_V2_ARTIFACT,
  HOSTED_PRIVACY_V3_CANDIDATE,
} from "./hosted-truth/legal-artifacts.mjs";
import {
  assertRenderedPrivacyV3Page,
  createPrivacyV3RenderPlan,
  renderPrivacyV3CandidatePage,
} from "./hosted-truth/privacy-v3-render.mjs";
import {
  PAGES_JOINT_LEGAL_V3_ROOT,
} from "./hosted-truth/pages-legal-v4.mjs";
import {
  assertPagesJointLegalV5Artifact,
  createPagesJointLegalV5Plan,
  pagesLegalV5Files,
} from "./hosted-truth/pages-legal-v5.mjs";

const DEFAULT_CATALOG_FILE = "data/abracadabra-hosted-catalog.held.json";
const COMMERCIAL_CONTROL_FILE = "data/abracadabra-commercial-control.json";
const RELEASE_CONTROL_FILE = "data/release-control.json";
const SLOT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const MARKER_PREFIX = "sitesourcery:truth-slot:";
const JOINT_LEGAL_V3_FINALIZATION_SCHEMA =
  "sitesourcery.hosted-joint-legal-v3-finalization/v1";
const JOINT_LEGAL_V3_RECEIPT_FILE =
  "joint-legal-v3-release-constants.json";
const JOINT_LEGAL_V4_FINALIZATION_SCHEMA =
  "sitesourcery.hosted-joint-legal-v4-finalization/v1";
const JOINT_LEGAL_V4_RECEIPT_FILE =
  "joint-legal-v4-release-constants.json";
const JOINT_LEGAL_V3_ROLES = Object.freeze([
  "privacy-current",
  "privacy-versioned",
  "website-terms-current",
  "website-terms-versioned",
  "legal-center-current",
]);
const JOINT_LEGAL_V4_ROLES = JOINT_LEGAL_V3_ROLES;
const JOINT_LEGAL_CURRENT_FILES = Object.freeze([
  "legal/index.html",
  "legal/privacy/index.html",
  "legal/website-terms/index.html",
]);
const FIN007_HOSTED_TRUTH_SLOTS = hostedTruthSlots;
const FIN007_HELD_TRUTH_REQUIREMENTS = Object.freeze({
  ...heldTruthRequirements,
  "index.html": Object.freeze(
    heldTruthRequirements["index.html"].map((phrase) => phrase ===
      "Three ways to start: make a free preview, get a $200 assessment of the site you have, or commission a custom build from $400."
      ? "Three ways to start: make a free preview, get a $350 assessment of the site you have, or commission a custom build from $350."
      : phrase),
  ),
  "abracadabra/how/index.html": Object.freeze([
    "Make your preview in six short steps.",
    "Looking is free. The private Download and Alakazam payment paths remain held",
    "Start building",
  ]),
});
const FIN007_HOSTED_TRUTH_REQUIREMENTS = Object.freeze({
  ...hostedTruthRequirements,
  "index.html": Object.freeze(
    hostedTruthRequirements["index.html"].map((phrase) => phrase ===
      "Three ways to start: make a free preview, get a $200 assessment of the site you have, or commission a custom build from $400."
      ? "Three ways to start: make a free preview, get a $350 assessment of the site you have, or commission a custom build from $350."
      : phrase),
  ),
  "abracadabra/how/index.html": Object.freeze([
    "Make your preview in six short steps.",
    "Looking is free. Download is $20 once per saved editor project",
    "Sign in only when you want to save the project, review its exact one-time $20 quote and delivery terms, and download the accepted HTML after payment.",
    "Start building",
  ]),
});
const FIN007_HOSTED_STAGING_ASSET_SHA256 = Object.freeze({
  ...hostedStagingAssetSha256,
  "abracadabra/app/abracadabra-api.js":
    "d9946f089312119a04d504fe87ed166f0f35efd9cfe81eb926d4dd017a17b1a9",
  "abracadabra/app/abracadabra-hosted-control.js":
    "cc3336358e99f252a4694d08d307dc37550525c7cf8ebf4e9c00e96fba5a6274",
  "abracadabra/app/abracadabra-customer-control-dom.js":
    "fec69c6174482ac42749317312c8f01437688f3ba8ad833d955521971c697257",
});

function lexical(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function occurrences(source, value) {
  return source.split(value).length - 1;
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return (
    relative !== ""
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

function marker(slot, edge) {
  if (slot.kind === "html") {
    return `<!-- ${MARKER_PREFIX}${slot.id}:${edge} -->`;
  }
  if (slot.kind === "js") {
    return `/* ${MARKER_PREFIX}${slot.id}:${edge} */`;
  }
  throw new Error(`truth slot ${slot.id} has unsupported kind ${slot.kind}`);
}

async function pathState(candidate) {
  try {
    return await lstat(candidate);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function assertPublicRelativePath(file) {
  if (
    typeof file !== "string"
    || file === ""
    || file.startsWith("/")
    || file.includes("\\")
    || path.posix.normalize(file) !== file
    || file.split("/").includes("..")
  ) {
    throw new Error(`invalid hosted artifact path: ${JSON.stringify(file)}`);
  }
}

async function assertRegularSource(root, file) {
  assertPublicRelativePath(file);
  const parts = file.split("/");
  let cursor = root;
  for (const [index, part] of parts.entries()) {
    cursor = path.join(cursor, part);
    const state = await pathState(cursor);
    if (!state) throw new Error(`hosted artifact source is missing: ${file}`);
    if (state.isSymbolicLink()) {
      throw new Error(`hosted artifact source traverses a symbolic link: ${file}`);
    }
    const final = index === parts.length - 1;
    if (final && !state.isFile()) {
      throw new Error(`hosted artifact source is not a regular file: ${file}`);
    }
    if (!final && !state.isDirectory()) {
      throw new Error(`hosted artifact source parent is not a directory: ${file}`);
    }
  }
}

function assertSortedUnique(values, label) {
  const sorted = [...values].sort(lexical);
  if (JSON.stringify(values) !== JSON.stringify(sorted)) {
    throw new Error(`${label} must remain bytewise sorted`);
  }
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} must not contain duplicates`);
  }
}

export const hostedOperatorAssets = Object.freeze([
  "operator/index.html",
  "operator/operator.css",
  "operator/operator.js",
]);

export const hostedFileAllowlist = Object.freeze(
  [
    ...publicFileAllowlist,
    ...hostedStagingAssets.filter((file) => !publicFileAllowlist.includes(file)),
    ...hostedOperatorAssets,
  ].sort(lexical),
);

function hostedFilesForPrivacyV3Plan(plan) {
  if (!plan) return hostedFileAllowlist;
  return Object.freeze(
    [...hostedFileAllowlist, plan.versionedFile].sort(lexical),
  );
}

function receiptHostedFile(file) {
  if (typeof file !== "string" || !file.startsWith("hosted/")) {
    throw new Error("joint legal V3 receipt artifact must be inside its hosted directory");
  }
  const relative = file.slice("hosted/".length);
  assertPublicRelativePath(relative);
  return relative;
}

function exactReceiptArtifact(value, role, expectedFile) {
  const relative = receiptHostedFile(value?.file);
  if (
    value?.role !== role
    || relative !== expectedFile
    || !SHA256.test(value?.sha256 ?? "")
    || !Number.isSafeInteger(value?.byteCount)
    || value.byteCount < 1
  ) {
    throw new Error(`joint legal V3 receipt artifact is invalid: ${role}`);
  }
  return Object.freeze({
    role,
    sourceFile: value.file,
    file: relative,
    sha256: value.sha256,
    byteCount: value.byteCount,
  });
}

async function createJointLegalV3FinalizationPlan(input) {
  if (input === undefined || input === null) return null;
  if (typeof input !== "string" || input.trim() === "") {
    throw new Error("joint legal V3 finalized input must be one explicit directory");
  }
  const root = path.resolve(input);
  await assertRegularSource(root, JOINT_LEGAL_V3_RECEIPT_FILE);
  const receipt = JSON.parse(
    await readFile(path.join(root, JOINT_LEGAL_V3_RECEIPT_FILE), "utf8"),
  );
  if (
    receipt?.schema !== JOINT_LEGAL_V3_FINALIZATION_SCHEMA
    || receipt.state !== "owner-approved-finalization"
    || receipt.sealable !== true
    || receipt.published !== false
    || receipt.integrationRequired !== true
    || !SHA256.test(receipt.authorityDigest ?? "")
    || !Array.isArray(receipt.documents)
    || receipt.documents.length !== 3
    || !Array.isArray(receipt.artifacts)
    || receipt.artifacts.length !== 5
    || JSON.stringify(receipt.artifacts.map(({ role }) => role)) !==
      JSON.stringify(JOINT_LEGAL_V3_ROLES)
  ) {
    throw new Error("joint legal V3 finalization receipt is invalid");
  }
  const [privacy, product, website] = receipt.documents;
  if (
    privacy?.kind !== "privacy"
    || product?.kind !== "product"
    || website?.kind !== "website"
    || !/^SS-HOSTED-PRIVACY-\d{4}-\d{2}-\d{2}-V3$/u.test(privacy.version ?? "")
    || !/^SS-HOSTED-WEBSITE-TERMS-\d{4}-\d{2}-\d{2}-V3$/u.test(website.version ?? "")
    || product.version !== website.version
    || product.contentDigest !== website.contentDigest
    || privacy.effectiveAt !== receipt.effectiveAt
    || product.effectiveAt !== receipt.effectiveAt
    || website.effectiveAt !== receipt.effectiveAt
  ) {
    throw new Error("joint legal V3 receipt document tuple is invalid");
  }
  const expectedFiles = [
    "legal/privacy/index.html",
    `legal/privacy/versions/${privacy.version}/index.html`,
    "legal/website-terms/index.html",
    `legal/website-terms/versions/${website.version}/index.html`,
    "legal/index.html",
  ];
  const artifacts = [];
  for (let index = 0; index < JOINT_LEGAL_V3_ROLES.length; index += 1) {
    const artifact = exactReceiptArtifact(
      receipt.artifacts[index],
      JOINT_LEGAL_V3_ROLES[index],
      expectedFiles[index],
    );
    await assertRegularSource(root, artifact.sourceFile);
    const bytes = await readFile(path.join(root, artifact.sourceFile));
    if (
      sha256(bytes) !== artifact.sha256
      || bytes.byteLength !== artifact.byteCount
    ) {
      throw new Error(`joint legal V3 finalized artifact changed: ${artifact.role}`);
    }
    artifacts.push(artifact);
  }
  for (const [currentIndex, versionedIndex] of [[0, 1], [2, 3]]) {
    if (
      artifacts[currentIndex].sha256 !== artifacts[versionedIndex].sha256
      || artifacts[currentIndex].byteCount !== artifacts[versionedIndex].byteCount
    ) {
      throw new Error("joint legal V3 current and versioned receipt identities differ");
    }
  }
  return Object.freeze({ root, receipt, artifacts: Object.freeze(artifacts) });
}

async function createJointLegalV4FinalizationPlan(input, sourceRoot) {
  if (input === undefined || input === null) return null;
  if (typeof input !== "string" || input.trim() === "") {
    throw new Error("joint legal V4 finalized input must be one explicit directory");
  }
  const root = path.resolve(input);
  await assertRegularSource(root, JOINT_LEGAL_V4_RECEIPT_FILE);
  const receipt = JSON.parse(
    await readFile(path.join(root, JOINT_LEGAL_V4_RECEIPT_FILE), "utf8"),
  );
  if (
    receipt?.schema !== JOINT_LEGAL_V4_FINALIZATION_SCHEMA
    || receipt.state !== "owner-approved-finalization"
    || receipt.sealable !== true
    || receipt.published !== false
    || receipt.integrationRequired !== true
    || receipt.authoritySchema !== "sitesourcery.project-legal-authority/v4"
    || receipt.acceptanceSchema !== "sitesourcery.project-legal-acceptance/v4"
    || !SHA256.test(receipt.authorityDigest ?? "")
    || !Array.isArray(receipt.documents)
    || receipt.documents.length !== 3
    || !Array.isArray(receipt.documentBindings)
    || JSON.stringify(receipt.documentBindings) !== JSON.stringify([
      { kind: "privacy", id: "00000000-0000-4000-8000-000000000049" },
      { kind: "product", id: "00000000-0000-4000-8000-000000000105" },
      { kind: "website", id: "00000000-0000-4000-8000-000000000106" },
    ])
    || !Array.isArray(receipt.artifacts)
    || receipt.artifacts.length !== 5
    || JSON.stringify(receipt.artifacts.map(({ role }) => role)) !==
      JSON.stringify(JOINT_LEGAL_V4_ROLES)
  ) throw new Error("joint legal V4 finalization receipt is invalid");
  const [privacy, product, website] = receipt.documents;
  if (
    privacy?.kind !== "privacy"
    || product?.kind !== "product"
    || website?.kind !== "website"
    || !/^SS-HOSTED-PRIVACY-\d{4}-\d{2}-\d{2}-V4$/u.test(privacy.version ?? "")
    || !/^SS-HOSTED-WEBSITE-TERMS-\d{4}-\d{2}-\d{2}-V4$/u.test(website.version ?? "")
    || product.version !== website.version
    || product.contentDigest !== website.contentDigest
    || privacy.effectiveAt !== receipt.effectiveAt
    || product.effectiveAt !== receipt.effectiveAt
    || website.effectiveAt !== receipt.effectiveAt
  ) throw new Error("joint legal V4 receipt document tuple is invalid");
  const expectedFiles = [
    "legal/privacy/index.html",
    `legal/privacy/versions/${privacy.version}/index.html`,
    "legal/website-terms/index.html",
    `legal/website-terms/versions/${website.version}/index.html`,
    "legal/index.html",
  ];
  const artifacts = [];
  for (let index = 0; index < JOINT_LEGAL_V4_ROLES.length; index += 1) {
    const artifact = exactReceiptArtifact(
      receipt.artifacts[index],
      JOINT_LEGAL_V4_ROLES[index],
      expectedFiles[index],
    );
    await assertRegularSource(root, artifact.sourceFile);
    const bytes = await readFile(path.join(root, artifact.sourceFile));
    if (sha256(bytes) !== artifact.sha256 || bytes.byteLength !== artifact.byteCount) {
      throw new Error(`joint legal V4 finalized artifact changed: ${artifact.role}`);
    }
    artifacts.push(artifact);
  }
  for (const [currentIndex, versionedIndex] of [[0, 1], [2, 3]]) {
    if (
      artifacts[currentIndex].sha256 !== artifacts[versionedIndex].sha256
      || artifacts[currentIndex].byteCount !== artifacts[versionedIndex].byteCount
    ) throw new Error("joint legal V4 current and versioned receipt identities differ");
  }
  const retainedV3 = await createJointLegalV3FinalizationPlan(
    path.join(sourceRoot, ...PAGES_JOINT_LEGAL_V3_ROOT.split("/")),
  );
  const retainedV3Versions = [
    retainedV3.artifacts[1],
    retainedV3.artifacts[3],
  ].map((artifact) => Object.freeze({
    ...artifact,
    sourceRoot: retainedV3.root,
  }));
  return Object.freeze({
    root,
    receipt,
    artifacts: Object.freeze([
      ...artifacts.map((artifact) => Object.freeze({
        ...artifact,
        sourceRoot: root,
      })),
      ...retainedV3Versions,
    ]),
  });
}

function hostedFilesForPlans(
  privacyV3Plan,
  jointLegalV3Plan,
  jointLegalV4Plan,
  jointLegalV5Plan,
) {
  const legalPlans = [
    jointLegalV3Plan,
    jointLegalV4Plan,
    jointLegalV5Plan,
  ].filter(Boolean);
  if ((privacyV3Plan && legalPlans.length > 0) || legalPlans.length > 1) {
    throw new Error("legal rendering and finalization inputs are mutually exclusive");
  }
  if (legalPlans.length === 0) return hostedFilesForPrivacyV3Plan(privacyV3Plan);
  if (jointLegalV5Plan) {
    return pagesLegalV5Files(hostedFileAllowlist, jointLegalV5Plan);
  }
  return Object.freeze([
    ...new Set([
      ...hostedFileAllowlist,
      ...legalPlans[0].artifacts.map(({ file }) => file),
    ]),
  ].sort(lexical));
}

export async function hostedFilesForJointLegalV4({
  root = process.cwd(),
  finalizationRoot,
} = {}) {
  const absoluteRoot = path.resolve(root);
  const plan = await createJointLegalV4FinalizationPlan(
    finalizationRoot,
    absoluteRoot,
  );
  if (!plan) {
    throw new Error("hosted joint Legal V4 file plan requires finalization");
  }
  return hostedFilesForPlans(null, null, plan, null);
}

export function hostedFilesForJointLegalV5({
  root = process.cwd(),
} = {}) {
  const plan = createPagesJointLegalV5Plan({ root: path.resolve(root) });
  return hostedFilesForPlans(null, null, null, plan);
}

export function hostedFilesForPrivacyV3Render(options) {
  return hostedFilesForPrivacyV3Plan(createPrivacyV3RenderPlan(options));
}

assertSortedUnique(hostedFileAllowlist, "hosted file allowlist");
assertSortedUnique(hostedOperatorAssets, "hosted operator assets");
assertPrivacyV3NotPublished(hostedFileAllowlist, "hosted file allowlist");
for (const file of heldAlakazamArtifactExcludedFiles) {
  if (hostedFileAllowlist.includes(file)) {
    throw new Error(`held Alakazam source cannot enter the hosted allowlist: ${file}`);
  }
}

async function walkArtifact(directory, root = directory) {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => lexical(left.name, right.name))) {
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    if (entry.isSymbolicLink()) {
      throw new Error(`hosted artifact contains a symbolic link: ${relative}`);
    }
    if (entry.isDirectory()) {
      files.push(...await walkArtifact(absolute, root));
    } else if (entry.isFile()) {
      files.push(relative);
    } else {
      throw new Error(`hosted artifact contains an unsupported entry: ${relative}`);
    }
  }
  return files;
}

function assertRequirementMap(sources, requirements, label) {
  for (const [file, phrases] of Object.entries(requirements)) {
    const source = sources.get(file);
    if (source == null) throw new Error(`${label} source is missing: ${file}`);
    for (const phrase of phrases) {
      if (!source.includes(phrase)) {
        throw new Error(`${file} is missing ${label} phrase ${JSON.stringify(phrase)}`);
      }
    }
  }
}

function assertNoPhrases(sources, phrases, label) {
  for (const [file, source] of sources) {
    for (const phrase of phrases) {
      if (source.includes(phrase)) {
        throw new Error(`${file} contains ${label} phrase ${JSON.stringify(phrase)}`);
      }
    }
  }
}

function assertNoPhraseMap(sources, forbiddenPhrases, label) {
  for (const [file, phrases] of Object.entries(forbiddenPhrases)) {
    const source = sources.get(file);
    if (source == null) throw new Error(`${label} source is missing: ${file}`);
    for (const phrase of phrases) {
      if (source.includes(phrase)) {
        throw new Error(`${file} contains ${label} phrase ${JSON.stringify(phrase)}`);
      }
    }
  }
}

export function assertNoHeldAlakazamExecutableSemantics(sources) {
  for (const [file, source] of sources) {
    if (!file.endsWith(".js")) continue;
    for (const semantic of heldAlakazamExecutableSemantics) {
      const match = String(source).match(new RegExp(semantic.pattern, "u"));
      if (match) {
        throw new Error(
          `${file} contains held Alakazam executable semantics `
          + `${semantic.id}: ${JSON.stringify(match[0])}`,
        );
      }
    }
  }
  return true;
}

export function assertNoHeldAlakazamCopySemantics(sources) {
  for (const [file, source] of sources) {
    for (const semantic of heldAlakazamCopyForbiddenSemantics) {
      const match = String(source).match(new RegExp(semantic.pattern, "iu"));
      if (match) {
        throw new Error(
          `${file} contains held Alakazam customer claim `
          + `${semantic.id}: ${JSON.stringify(match[0])}`,
        );
      }
    }
  }
  return true;
}

export function assertHostedAlakazamUiHeld(source) {
  const customerControl = String(source);
  const heldState = 'var ALAKAZAM_PUBLIC_OFFER_STATE = "held";';
  if (occurrences(customerControl, heldState) !== 1) {
    throw new Error("hosted customer control must keep Alakazam explicitly held");
  }
  const requestStart = customerControl.indexOf(
    "function requestAlakazamAccount(projectId)",
  );
  const requestEnd = customerControl.indexOf(
    "function refreshAlakazamAccountAfterSetup",
    requestStart,
  );
  const requestSource = customerControl.slice(requestStart, requestEnd);
  if (
    requestStart < 0
    || requestEnd <= requestStart
    || requestSource.indexOf('ALAKAZAM_PUBLIC_OFFER_STATE !== "released"') < 0
    || requestSource.indexOf('ALAKAZAM_PUBLIC_OFFER_STATE !== "released"')
      > requestSource.indexOf(".getAlakazamAccount(selectedProjectId)")
  ) {
    throw new Error("held Alakazam account reads must fail before any API call");
  }
  const renderStart = customerControl.indexOf("function renderAlakazamAccount(state)");
  const renderEnd = customerControl.indexOf("function reducedMotion", renderStart);
  const renderSource = customerControl.slice(renderStart, renderEnd);
  if (
    renderStart < 0
    || renderEnd <= renderStart
    || !renderSource.includes('ALAKAZAM_PUBLIC_OFFER_STATE !== "released"')
    || renderSource.indexOf('ALAKAZAM_PUBLIC_OFFER_STATE !== "released"')
      > renderSource.indexOf("requestAlakazamAccount(projectId)")
  ) {
    throw new Error("held Alakazam rendering must return before account loading");
  }
  const capabilityStart = customerControl.indexOf("var capabilityRequest =");
  const capabilityEnd = customerControl.indexOf("Promise.all([", capabilityStart);
  const capabilitySource = customerControl.slice(capabilityStart, capabilityEnd);
  if (
    capabilityStart < 0
    || capabilityEnd <= capabilityStart
    || occurrences(
      capabilitySource,
      'ALAKAZAM_PUBLIC_OFFER_STATE === "released"',
    ) !== 4
  ) {
    throw new Error("held Alakazam capabilities must remain false despite server input");
  }
  const insertionStart = customerControl.indexOf("var alakazamAnchor =");
  const insertionEnd = customerControl.indexOf("function value(name)", insertionStart);
  const insertionSource = customerControl.slice(insertionStart, insertionEnd);
  if (
    insertionStart < 0
    || insertionEnd <= insertionStart
    || occurrences(insertionSource, "alakazamPanel.element") !== 2
    || occurrences(
      insertionSource,
      'ALAKAZAM_PUBLIC_OFFER_STATE === "released"',
    ) !== 2
  ) {
    throw new Error("held Alakazam panel must never enter the customer DOM");
  }
  return true;
}

export function assertHeldTruthSemantics(sources) {
  assertRequirementMap(sources, FIN007_HELD_TRUTH_REQUIREMENTS, "held truth");
  assertNoPhrases(sources, hostedOnlyPhrases, "hosted-only");
  assertNoPhraseMap(
    sources,
    heldTruthForbiddenPhrases,
    "retired held-product",
  );
  assertNoHeldAlakazamExecutableSemantics(sources);
  return true;
}

function assertManifestShape() {
  const ids = new Set();
  const fragmentPaths = new Set();
  for (const slot of FIN007_HOSTED_TRUTH_SLOTS) {
    if (!SLOT_ID.test(slot.id)) {
      throw new Error(`invalid hosted truth slot id: ${JSON.stringify(slot.id)}`);
    }
    if (ids.has(slot.id)) throw new Error(`duplicate hosted truth slot id: ${slot.id}`);
    ids.add(slot.id);
    assertPublicRelativePath(slot.file);
    assertPublicRelativePath(slot.hostedFragment);
    if (!publicFileAllowlist.includes(slot.file)) {
      throw new Error(`hosted truth slot file is not public: ${slot.file}`);
    }
    if (!slot.hostedFragment.startsWith("scripts/hosted-truth/fragments/")) {
      throw new Error(`hosted truth fragment is outside the reviewed directory: ${slot.id}`);
    }
    if (fragmentPaths.has(slot.hostedFragment)) {
      throw new Error(`hosted truth fragment is reused: ${slot.hostedFragment}`);
    }
    fragmentPaths.add(slot.hostedFragment);
    if (!SHA256.test(slot.sourceSha256) || !SHA256.test(slot.hostedSha256)) {
      throw new Error(`hosted truth slot has an invalid digest: ${slot.id}`);
    }
    const expectedExtension = slot.kind === "js" ? ".js" : ".html";
    if (!slot.hostedFragment.endsWith(expectedExtension)) {
      throw new Error(`hosted truth slot fragment type does not match: ${slot.id}`);
    }
  }
  for (const transform of hostedCodeTransforms) {
    if (!SLOT_ID.test(transform.id)) {
      throw new Error(`invalid hosted code transform id: ${JSON.stringify(transform.id)}`);
    }
    if (ids.has(transform.id)) {
      throw new Error(`duplicate hosted transform id: ${transform.id}`);
    }
    ids.add(transform.id);
    assertPublicRelativePath(transform.file);
    if (!hostedStagingAssets.includes(transform.file)) {
      throw new Error(
        `hosted code transform file is not an explicit hosted staging asset: ${transform.file}`,
      );
    }
    if (
      typeof transform.startMarker !== "string"
      || transform.startMarker === ""
      || !SHA256.test(transform.sourceSha256)
      || !SHA256.test(transform.outputSha256)
    ) {
      throw new Error(`hosted code transform is invalid: ${transform.id}`);
    }
  }
  const reviewedStagingAssets = Object.keys(FIN007_HOSTED_STAGING_ASSET_SHA256);
  if (JSON.stringify(reviewedStagingAssets) !== JSON.stringify(hostedStagingAssets)) {
    throw new Error(
      "hosted staging asset digest ledger must exactly match the hosted staging allowlist",
    );
  }
  for (const [file, digest] of Object.entries(FIN007_HOSTED_STAGING_ASSET_SHA256)) {
    assertPublicRelativePath(file);
    if (!SHA256.test(digest)) {
      throw new Error(`hosted staging asset has an invalid digest: ${file}`);
    }
  }
  const heldCopyFiles = Object.keys(heldAlakazamCopyFragmentSha256);
  assertSortedUnique(heldCopyFiles, "held Alakazam copy fragment ledger");
  for (const [file, digest] of Object.entries(heldAlakazamCopyFragmentSha256)) {
    assertPublicRelativePath(file);
    if (
      !file.startsWith("scripts/hosted-truth/fragments/")
      || !SHA256.test(digest)
    ) {
      throw new Error(`held Alakazam copy fragment ledger is invalid: ${file}`);
    }
  }
  assertSortedUnique(
    heldAlakazamCustomerArtifactFiles,
    "held Alakazam customer artifact files",
  );
  for (const semantic of heldAlakazamCopyForbiddenSemantics) {
    if (
      !SLOT_ID.test(semantic.id)
      || typeof semantic.pattern !== "string"
      || semantic.pattern === ""
      || !new RegExp(semantic.pattern, "iu").test(semantic.example)
    ) {
      throw new Error(`held Alakazam copy semantic is invalid: ${semantic.id}`);
    }
  }
}

async function assertHostedStagingAssets(absoluteRoot) {
  for (const [file, expectedDigest] of Object.entries(FIN007_HOSTED_STAGING_ASSET_SHA256)) {
    await assertRegularSource(absoluteRoot, file);
    const actualDigest = sha256(
      await readFile(path.join(absoluteRoot, ...file.split("/"))),
    );
    if (actualDigest !== expectedDigest) {
      throw new Error(
        `hosted staging asset changed without reviewed manifest update: ${file}`,
      );
    }
  }
}

async function loadAndValidateHeldSources(absoluteRoot) {
  assertManifestShape();
  const files = [...new Set([
    ...FIN007_HOSTED_TRUTH_SLOTS.map(({ file }) => file),
    ...Object.keys(FIN007_HELD_TRUTH_REQUIREMENTS),
  ])].sort(lexical);
  const sources = new Map();
  for (const file of files) {
    await assertRegularSource(absoluteRoot, file);
    sources.set(file, await readFile(path.join(absoluteRoot, file), "utf8"));
  }

  for (const slot of FIN007_HOSTED_TRUTH_SLOTS) {
    const source = sources.get(slot.file);
    const start = marker(slot, "start");
    const end = marker(slot, "end");
    if (occurrences(source, start) !== 1 || occurrences(source, end) !== 1) {
      throw new Error(`truth slot markers must each appear once: ${slot.id}`);
    }
    const startIndex = source.indexOf(start);
    const endIndex = source.indexOf(end);
    if (startIndex >= endIndex) {
      throw new Error(`truth slot markers are out of order: ${slot.id}`);
    }
    const heldContent = source.slice(startIndex + start.length, endIndex);
    if (sha256(heldContent) !== slot.sourceSha256) {
      throw new Error(`held truth changed without reviewed manifest update: ${slot.id}`);
    }

    await assertRegularSource(absoluteRoot, slot.hostedFragment);
    const hostedContent = await readFile(
      path.join(absoluteRoot, slot.hostedFragment),
      "utf8",
    );
    if (sha256(hostedContent) !== slot.hostedSha256) {
      throw new Error(`hosted truth changed without reviewed manifest update: ${slot.id}`);
    }
    if (hostedContent.includes(MARKER_PREFIX)) {
      throw new Error(`hosted truth fragment contains a slot marker: ${slot.id}`);
    }
  }
  const heldCopySources = new Map();
  for (const [file, expectedDigest] of Object.entries(
    heldAlakazamCopyFragmentSha256,
  )) {
    await assertRegularSource(absoluteRoot, file);
    const source = await readFile(path.join(absoluteRoot, file), "utf8");
    if (sha256(source) !== expectedDigest) {
      throw new Error(`held Alakazam copy changed without review: ${file}`);
    }
    heldCopySources.set(file, source);
  }
  assertNoHeldAlakazamCopySemantics(heldCopySources);
  for (const transform of hostedCodeTransforms) {
    await assertRegularSource(absoluteRoot, transform.file);
    const source = await readFile(path.join(absoluteRoot, transform.file), "utf8");
    if (sha256(source) !== transform.sourceSha256) {
      throw new Error(`hosted code source changed without review: ${transform.id}`);
    }
    if (occurrences(source, transform.startMarker) !== 1) {
      throw new Error(`hosted code start marker must appear once: ${transform.id}`);
    }
    const output = source.slice(source.indexOf(transform.startMarker));
    if (sha256(output) !== transform.outputSha256) {
      throw new Error(`hosted code output changed without review: ${transform.id}`);
    }
  }

  assertHeldTruthSemantics(sources);
  const shippedJavascript = new Map();
  for (const file of publicFileAllowlist.filter((candidate) => candidate.endsWith(".js"))) {
    shippedJavascript.set(
      file,
      await readFile(path.join(absoluteRoot, ...file.split("/")), "utf8"),
    );
  }
  assertNoHeldAlakazamExecutableSemantics(shippedJavascript);
  assertHostedAlakazamUiHeld(
    await readFile(
      path.join(
        absoluteRoot,
        "abracadabra/app/abracadabra-customer-control-dom.js",
      ),
      "utf8",
    ),
  );
  return sources;
}

export async function assertHeldSourceTruth({ root = process.cwd() } = {}) {
  const absoluteRoot = path.resolve(root);
  const rootState = await lstat(absoluteRoot);
  if (!rootState.isDirectory() || rootState.isSymbolicLink()) {
    throw new Error(`site root must be a real directory: ${absoluteRoot}`);
  }
  await loadAndValidateHeldSources(absoluteRoot);
  return true;
}

async function transformedTruthSources(absoluteRoot) {
  const heldSources = await loadAndValidateHeldSources(absoluteRoot);
  const transformed = new Map();
  const slotsByFile = new Map();
  for (const slot of FIN007_HOSTED_TRUTH_SLOTS) {
    const slots = slotsByFile.get(slot.file) ?? [];
    slots.push(slot);
    slotsByFile.set(slot.file, slots);
  }

  for (const [file, slots] of slotsByFile) {
    const original = heldSources.get(file);
    const replacements = [];
    for (const slot of slots) {
      const start = marker(slot, "start");
      const end = marker(slot, "end");
      const startIndex = original.indexOf(start);
      const endIndex = original.indexOf(end) + end.length;
      const hostedContent = await readFile(
        path.join(absoluteRoot, slot.hostedFragment),
        "utf8",
      );
      replacements.push({
        id: slot.id,
        startIndex,
        endIndex,
        hostedContent: hostedContent.trimEnd(),
      });
    }
    replacements.sort((left, right) => right.startIndex - left.startIndex);
    let next = original;
    for (const replacement of replacements) {
      next =
        next.slice(0, replacement.startIndex)
        + replacement.hostedContent
        + next.slice(replacement.endIndex);
    }
    if (next.includes(MARKER_PREFIX)) {
      throw new Error(`${file} retains an untransformed truth slot marker`);
    }
    transformed.set(file, next);
  }
  for (const transform of hostedCodeTransforms) {
    if (transformed.has(transform.file)) {
      throw new Error(`hosted code transform overlaps a truth-slot file: ${transform.file}`);
    }
    await assertRegularSource(absoluteRoot, transform.file);
    const source = await readFile(path.join(absoluteRoot, transform.file), "utf8");
    if (sha256(source) !== transform.sourceSha256) {
      throw new Error(`hosted code source changed without review: ${transform.id}`);
    }
    if (occurrences(source, transform.startMarker) !== 1) {
      throw new Error(`hosted code start marker must appear once: ${transform.id}`);
    }
    const output = source.slice(source.indexOf(transform.startMarker));
    if (sha256(output) !== transform.outputSha256) {
      throw new Error(`hosted code output changed without review: ${transform.id}`);
    }
    transformed.set(transform.file, output);
  }
  return transformed;
}

function assertHeldControls(commercialControl, releaseControl, catalog) {
  if (
    commercialControl?.state !== "hold"
    || commercialControl?.checkout?.enabled !== false
    || commercialControl?.domainCheckout?.enabled !== false
    || commercialControl?.costPolicy?.providerPurchasesAuthorized !== false
    || commercialControl?.costPolicy?.automaticProviderUpgradesAllowed !== false
    || commercialControl?.costPolicy?.automaticUsageOveragesAllowed !== false
  ) {
    throw new Error("hosted artifact build requires payment, domain, spend, and provider controls to remain held");
  }
  if (
    releaseControl?.state !== "hold"
    || releaseControl?.allowsDeployment !== false
    || releaseControl?.allowsCommercialDeployment !== false
  ) {
    throw new Error("hosted artifact build requires publication authority to remain held");
  }
  if (catalog?.state !== "hold") {
    throw new Error("hosted browser catalog must remain explicitly held");
  }
  const products = Array.isArray(catalog.products) ? catalog.products : [];
  if (
    products.length !== 1
    || products[0]?.productId !== "spark"
    || products[0]?.implementationContract !== "abracadabra.spark/v1"
  ) {
    throw new Error("hosted browser catalog must expose only released Spark");
  }
  const tenures = new Set((catalog.tenures ?? []).map(({ tenureId }) => tenureId));
  if (
    tenures.size !== 3
    || !tenures.has("rent")
    || !tenures.has("own")
    || !tenures.has("owned_managed")
  ) {
    throw new Error("hosted browser catalog must keep all three tenure choices distinct");
  }
  const offers = Object.fromEntries(
    (catalog.offers ?? []).map((offer) => [offer.offerId, offer]),
  );
  if (
    Object.keys(offers).length !== 3
    || JSON.stringify(offers["spark.own"]?.eligibleAddressModes) !==
      JSON.stringify(["customer_owned"])
  ) {
    throw new Error("hosted browser catalog must keep Own off licensed Site Sourcery addresses");
  }
}

async function loadHeldBuildInputs(absoluteRoot, catalogFile) {
  for (const file of [
    catalogFile,
    COMMERCIAL_CONTROL_FILE,
    RELEASE_CONTROL_FILE,
  ]) {
    await assertRegularSource(absoluteRoot, file);
  }
  const [catalog, commercialControl, releaseControl] = await Promise.all(
    [catalogFile, COMMERCIAL_CONTROL_FILE, RELEASE_CONTROL_FILE].map(
      async (file) => JSON.parse(await readFile(path.join(absoluteRoot, file), "utf8")),
    ),
  );
  assertHeldControls(commercialControl, releaseControl, catalog);
  return { catalog, commercialControl, releaseControl };
}

function resolveBuildPaths(root, output) {
  const absoluteRoot = path.resolve(root);
  const defaultOutput = path.join(absoluteRoot, "_hosted");
  const absoluteOutput = path.resolve(output ?? defaultOutput);
  if (absoluteOutput === absoluteRoot) {
    throw new Error("hosted artifact output cannot replace the source root");
  }
  if (
    absoluteOutput !== defaultOutput
    && isInside(absoluteRoot, absoluteOutput)
  ) {
    throw new Error("custom hosted artifact output must be outside the source root");
  }
  return { absoluteOutput, absoluteRoot };
}

async function assertReplaceableOutput(absoluteOutput) {
  const state = await pathState(absoluteOutput);
  if (!state) return;
  if (state.isSymbolicLink() || !state.isDirectory()) {
    throw new Error(`hosted artifact output must be a real directory: ${absoluteOutput}`);
  }
}

async function writeHostedArtifact({
  absoluteRoot,
  staging,
  transformed,
  catalog,
  privacyV3Plan,
  jointLegalV3Plan,
  jointLegalV4Plan,
  jointLegalV5Plan,
  artifactFiles,
}) {
  const jointLegalPlan = jointLegalV4Plan ?? jointLegalV3Plan;
  await mkdir(staging, { recursive: false });
  const candidatePage = transformed.get(HOSTED_PRIVACY_V3_CANDIDATE.currentFile);
  const renderedPrivacy = privacyV3Plan
    ? renderPrivacyV3CandidatePage(candidatePage, privacyV3Plan)
    : null;
  for (const file of artifactFiles) {
    const destination = path.join(staging, ...file.split("/"));
    await mkdir(path.dirname(destination), { recursive: true });
    const finalizedV5Source = jointLegalV5Plan?.sourceByFile.get(file);
    if (finalizedV5Source) {
      await copyFile(finalizedV5Source, destination);
      continue;
    }
    const finalizedLegalArtifact = jointLegalPlan?.artifacts.find(
      (artifact) => artifact.file === file,
    );
    if (finalizedLegalArtifact) {
      await copyFile(
        path.join(
          finalizedLegalArtifact.sourceRoot ?? jointLegalPlan.root,
          finalizedLegalArtifact.sourceFile,
        ),
        destination,
      );
      continue;
    }
    if (
      file === HOSTED_PRIVACY_V3_CANDIDATE.currentFile
      && !privacyV3Plan
    ) {
      await copyFile(
        path.join(absoluteRoot, ...HOSTED_PRIVACY_V2_ARTIFACT.file.split("/")),
        destination,
      );
      continue;
    }
    if (
      privacyV3Plan
      && (
        file === HOSTED_PRIVACY_V3_CANDIDATE.currentFile
        || file === privacyV3Plan.versionedFile
      )
    ) {
      await writeFile(destination, renderedPrivacy, "utf8");
      continue;
    }
    let content = transformed.get(file);
    if (file === "abracadabra/app/index.html") {
      content = configureHostedAbracadabraHtml(content, { catalog });
    }
    if (content != null) {
      await writeFile(destination, content, "utf8");
    } else {
      await copyFile(
        path.join(absoluteRoot, ...file.split("/")),
        destination,
      );
    }
  }
}

function assertJointLegalV3Truth(sources) {
  assertRequirementMap(sources, {
    "legal/index.html": [
      "$5 HTML Download",
      "$200 Website assessment",
      "accepted Custom builds",
      "A later Alakazam release requires Privacy V4",
      "The Responder remain held",
    ],
    "legal/privacy/index.html": [
      "$5 Download",
      "$200 Website assessment",
      "automatic-tax inputs and results",
      "Resend processes the destination address",
      "The Responder is held from sale",
      "Alakazam, Care, domain-purchase, publication, and Responder checkout or billing remain held",
    ],
    "legal/website-terms/index.html": [
      "completed one-time $5 payment",
      "standard Website assessment costs $200",
      "Custom work begins only after",
      "automatic-tax status and result",
      "The Responder is held from sale",
      "A later Alakazam release requires its separately approved Privacy V4",
    ],
  }, "joint legal V3 truth");
  const forbidden = [
    "noindex",
    "data-legal-v3-source-state",
    "SS-HOSTED-PRIVACY-V3-UNSEALED",
    "SS-HOSTED-WEBSITE-TERMS-V3-UNSEALED",
    "SS-HOSTED-PRIVACY-2026-07-30-V2",
    "SS-HOSTED-WEBSITE-TERMS-2026-07-30-V2",
    "review source",
    "review only",
    "CONTENT-TEMPLATE",
  ];
  assertNoPhrases(sources, forbidden, "unreleased joint legal V3");
  for (const [file, source] of sources) {
    if (
      /\b(?:buy|start|activate|subscribe to) (?:an? )?(?:Alakazam|Responder|customer domain)\b/iu.test(source)
      || /(?:Alakazam (?:plan|subscription)|Responder (?:plan|service))[^.\n]{0,120}\$(?:\d)/iu.test(source)
    ) {
      throw new Error(`${file} contains a held-service offer`);
    }
  }
}

function assertJointLegalV4Truth(sources) {
  assertRequirementMap(sources, {
    "legal/index.html": [
      "Privacy V4 and Website Terms V4",
      "$5 HTML Download",
      "$200 Website assessment",
      "accepted Custom builds",
    ],
    "legal/privacy/index.html": [
      "Cloudflare is Site Sourcery’s authoritative DNS provider",
      "HTTPS connection terminates at Cloudflare",
      "encrypted, outbound-only Cloudflare Tunnel",
      "does not use Cloudflare advertising, Cloudflare Web Analytics, Workers, email routing, Turnstile",
      "Alakazam, Care, domain-purchase, publication, and Responder checkout or billing remain held",
    ],
    "legal/website-terms/index.html": [
      "completed one-time $5 payment",
      "standard Website assessment costs $200",
      "Custom work begins only after",
      "Alakazam subscriptions, hosting activation, publication, Care, lifecycle, and tier features remain held",
    ],
  }, "joint legal V4 truth");
  assertNoPhrases(sources, [
    "noindex",
    "data-legal-v4-review-state",
    "SS-HOSTED-PRIVACY-V4-UNSEALED",
    "SS-HOSTED-WEBSITE-TERMS-V4-UNSEALED",
    "JOINT-REVIEW-DRAFT-V4",
    "CONTENT-TEMPLATE",
  ], "unreleased joint legal V4");
}

async function assertJointLegalArtifact(output, plan) {
  for (const artifact of plan.artifacts) {
    const bytes = await readFile(path.join(output, ...artifact.file.split("/")));
    if (
      sha256(bytes) !== artifact.sha256
      || bytes.byteLength !== artifact.byteCount
    ) {
      throw new Error(`hosted joint legal artifact mismatch: ${artifact.role}`);
    }
  }
  for (const [currentIndex, versionedIndex] of [[0, 1], [2, 3]]) {
    const current = await readFile(
      path.join(output, ...plan.artifacts[currentIndex].file.split("/")),
    );
    const versioned = await readFile(
      path.join(output, ...plan.artifacts[versionedIndex].file.split("/")),
    );
    if (!current.equals(versioned)) {
      throw new Error("hosted joint legal current and versioned bytes differ");
    }
  }
}

export async function verifyHostedArtifact({
  root = process.cwd(),
  output = path.join(path.resolve(root), "_hosted"),
  privacyV3Render,
  jointLegalV3FinalizationRoot,
  jointLegalV4FinalizationRoot,
} = {}) {
  const absoluteRoot = path.resolve(root);
  const absoluteOutput = path.resolve(output);
  const privacyV3Plan = privacyV3Render
    ? createPrivacyV3RenderPlan(privacyV3Render)
    : null;
  const jointLegalV3Plan = await createJointLegalV3FinalizationPlan(
    jointLegalV3FinalizationRoot,
  );
  const jointLegalV4Plan = await createJointLegalV4FinalizationPlan(
    jointLegalV4FinalizationRoot,
    absoluteRoot,
  );
  const jointLegalV5Plan = privacyV3Plan || jointLegalV3Plan || jointLegalV4Plan
    ? null
    : createPagesJointLegalV5Plan({ root: absoluteRoot });
  const artifactFiles = hostedFilesForPlans(
    privacyV3Plan,
    jointLegalV3Plan,
    jointLegalV4Plan,
    jointLegalV5Plan,
  );
  assertImmutableLegalArtifactSources({ root: absoluteRoot });
  assertPrivacyV3CandidateSources({ root: absoluteRoot });
  const outputState = await lstat(absoluteOutput);
  if (!outputState.isDirectory() || outputState.isSymbolicLink()) {
    throw new Error(`hosted artifact must be a real directory: ${absoluteOutput}`);
  }
  assertImmutableLegalArtifactSources({ root: absoluteOutput });
  if (jointLegalV5Plan) {
    assertPagesJointLegalV5Artifact(absoluteOutput, jointLegalV5Plan);
  } else if (jointLegalV3Plan || jointLegalV4Plan) {
    await assertJointLegalArtifact(
      absoluteOutput,
      jointLegalV4Plan ?? jointLegalV3Plan,
    );
  } else if (privacyV3Plan) {
    const current = await readFile(
      path.join(absoluteOutput, HOSTED_PRIVACY_V3_CANDIDATE.currentFile),
    );
    const versioned = await readFile(
      path.join(absoluteOutput, privacyV3Plan.versionedFile),
    );
    if (!current.equals(versioned)) {
      throw new Error("hosted privacy V3 current and versioned bytes differ");
    }
    assertRenderedPrivacyV3Page(current.toString("utf8"), privacyV3Plan);
  } else {
    assertUnsealedPrivacyCurrentAlias({ root: absoluteOutput });
  }
  const actual = (await walkArtifact(absoluteOutput)).sort(lexical);
  if (JSON.stringify(actual) !== JSON.stringify(artifactFiles)) {
    const expected = new Set(artifactFiles);
    const seen = new Set(actual);
    const missing = artifactFiles.filter((file) => !seen.has(file));
    const unexpected = actual.filter((file) => !expected.has(file));
    throw new Error(
      `hosted artifact ledger mismatch; missing: ${missing.join(", ") || "none"}; `
      + `unexpected: ${unexpected.join(", ") || "none"}`,
    );
  }
  for (const file of heldAlakazamArtifactExcludedFiles) {
    if (actual.includes(file)) {
      throw new Error(`hosted artifact contains held Alakazam source file: ${file}`);
    }
  }
  for (const file of hostedStagingAssets) {
    const transform = hostedCodeTransforms.find(
      (candidate) => candidate.file === file,
    );
    const expectedDigest = transform
      ? transform.outputSha256
      : FIN007_HOSTED_STAGING_ASSET_SHA256[file];
    const actualDigest = sha256(
      await readFile(path.join(absoluteOutput, ...file.split("/"))),
    );
    if (actualDigest !== expectedDigest) {
      throw new Error(`hosted artifact staging asset digest mismatch: ${file}`);
    }
  }
  const artifactTextSources = new Map();
  for (const file of actual.filter((candidate) => /\.(?:html|js|json|xml|txt)$/u.test(candidate))) {
    const source = await readFile(path.join(absoluteOutput, file), "utf8");
    artifactTextSources.set(file, source);
    if (source.includes("/abracadabra/site/")) {
      throw new Error(`${file} references the source-only Abracadabra viewer`);
    }
    if (source.includes(MARKER_PREFIX)) {
      throw new Error(`${file} contains a truth slot marker after hosted transformation`);
    }
  }
  assertNoHeldAlakazamExecutableSemantics(artifactTextSources);
  assertNoPhrases(artifactTextSources, heldOnlyPhrases, "held-only");
  assertNoHeldAlakazamCopySemantics(new Map(
    heldAlakazamCustomerArtifactFiles.map((file) => [
      file,
      artifactTextSources.get(file),
    ]),
  ));
  assertHostedAlakazamUiHeld(
    artifactTextSources.get(
      "abracadabra/app/abracadabra-customer-control-dom.js",
    ),
  );

  const truthFiles = Object.keys(FIN007_HOSTED_TRUTH_REQUIREMENTS);
  const sources = new Map(
    await Promise.all(
      truthFiles.map(async (file) => [
        file,
        await readFile(path.join(absoluteOutput, file), "utf8"),
      ]),
    ),
  );
  const applicableTruthRequirements = (
    jointLegalV3Plan || jointLegalV4Plan || jointLegalV5Plan
  )
    ? Object.fromEntries(
      Object.entries(FIN007_HOSTED_TRUTH_REQUIREMENTS).filter(
        ([file]) => !JOINT_LEGAL_CURRENT_FILES.includes(file),
      ),
    )
    : privacyV3Plan
    ? Object.fromEntries(
      Object.entries(FIN007_HOSTED_TRUTH_REQUIREMENTS).filter(
        ([file]) => file !== HOSTED_PRIVACY_V3_CANDIDATE.currentFile,
      ),
    )
    : FIN007_HOSTED_TRUTH_REQUIREMENTS;
  assertRequirementMap(sources, applicableTruthRequirements, "hosted truth");
  if (jointLegalV3Plan) {
    assertJointLegalV3Truth(new Map(
      JOINT_LEGAL_CURRENT_FILES.map((file) => [file, sources.get(file)]),
    ));
  }
  if (jointLegalV4Plan) {
    assertJointLegalV4Truth(new Map(
      JOINT_LEGAL_CURRENT_FILES.map((file) => [file, sources.get(file)]),
    ));
  }

  const app = sources.get("abracadabra/app/index.html");
  if (
    occurrences(
      app,
      '<meta name="sitesourcery-abracadabra-control-mode" content="hosted">',
    ) !== 1
    || app.includes(
      '<meta name="sitesourcery-abracadabra-control-mode" content="hold">',
    )
  ) {
    throw new Error("hosted Abracadabra mode must be injected exactly once");
  }
  if (app.includes("/abracadabra/site/")) {
    throw new Error("hosted Abracadabra app links to the source-only local viewer");
  }
  if (
    app.includes("abracadabra-hosted-catalog")
    || occurrences(
      app,
      "/abracadabra/app/abracadabra-customer-control-dom.js",
    ) !== 1
    || app.includes(
      "/abracadabra/app/abracadabra-hosted-control-dom.js",
    )
  ) {
    throw new Error(
      "hosted Abracadabra must load the customer-first control without a browser catalog",
    );
  }
  for (const localOnlyAsset of [
    "/abracadabra/app/abracadabra-account.js",
    "/abracadabra/app/abracadabra-paid-download.js",
  ]) {
    if (app.includes(localOnlyAsset)) {
      throw new Error(`hosted Abracadabra loads browser-only bridge ${localOnlyAsset}`);
    }
  }
  if (/https:\/\/buy\.stripe\.com\//u.test(app)) {
    throw new Error("hosted Abracadabra must use the held server checkout boundary, not a direct payment link");
  }
  const makerSteps = ["vibe", "facts", "truth", "preview"];
  for (const step of makerSteps) {
    if (occurrences(app, `data-step="${step}"`) !== 1) {
      throw new Error(`hosted Abracadabra must keep exactly one current maker step: ${step}`);
    }
  }
  for (const retiredStep of ["details", "contact"]) {
    if (app.includes(`data-step="${retiredStep}"`)) {
      throw new Error(`hosted Abracadabra restored retired maker step: ${retiredStep}`);
    }
  }
  const customerStages = ["account", "project", "quote", "download"];
  let priorStage = -1;
  for (const stage of customerStages) {
    const marker = `data-customer-stage="${stage}"`;
    if (occurrences(app, marker) !== 1 || app.indexOf(marker) <= priorStage) {
      throw new Error(`hosted Abracadabra customer stage is missing, duplicated, or out of order: ${stage}`);
    }
    priorStage = app.indexOf(marker);
  }
  for (const field of [
    'name="accountName"',
    'name="organizationName"',
    'name="accountEmail"',
    'name="accountPassword"',
  ]) {
    if (occurrences(app, field) !== 1) {
      throw new Error(`hosted Abracadabra real account field must appear exactly once: ${field}`);
    }
  }
  if (app.includes("Alacazam")) {
    throw new Error("hosted Abracadabra contains the retired Alacazam spelling");
  }
  return true;
}

async function promoteArtifact(staging, absoluteOutput) {
  await assertReplaceableOutput(absoluteOutput);
  const currentState = await pathState(absoluteOutput);
  const backup = `${absoluteOutput}.previous-${randomUUID()}`;
  let movedCurrent = false;
  try {
    if (currentState) {
      await rename(absoluteOutput, backup);
      movedCurrent = true;
    }
    await rename(staging, absoluteOutput);
  } catch (error) {
    if (movedCurrent && !(await pathState(absoluteOutput))) {
      await rename(backup, absoluteOutput);
    }
    throw error;
  }
  if (movedCurrent) await rm(backup, { recursive: true, force: false });
}

export async function buildHostedArtifact({
  root = process.cwd(),
  output,
  catalogFile = DEFAULT_CATALOG_FILE,
  privacyV3Render,
  jointLegalV3FinalizationRoot,
  jointLegalV4FinalizationRoot,
} = {}) {
  const { absoluteOutput, absoluteRoot } = resolveBuildPaths(root, output);
  const privacyV3Plan = privacyV3Render
    ? createPrivacyV3RenderPlan(privacyV3Render)
    : null;
  const jointLegalV3Plan = await createJointLegalV3FinalizationPlan(
    jointLegalV3FinalizationRoot,
  );
  const jointLegalV4Plan = await createJointLegalV4FinalizationPlan(
    jointLegalV4FinalizationRoot,
    absoluteRoot,
  );
  const jointLegalV5Plan = privacyV3Plan || jointLegalV3Plan || jointLegalV4Plan
    ? null
    : createPagesJointLegalV5Plan({ root: absoluteRoot });
  if (
    (privacyV3Plan || jointLegalV3Plan)
    && absoluteOutput === path.join(absoluteRoot, "_hosted")
  ) {
    throw new Error("legal review/finalization output must remain outside the repository");
  }
  const artifactFiles = hostedFilesForPlans(
    privacyV3Plan,
    jointLegalV3Plan,
    jointLegalV4Plan,
    jointLegalV5Plan,
  );
  assertImmutableLegalArtifactSources({ root: absoluteRoot });
  assertPrivacyV3CandidateSources({ root: absoluteRoot });
  const rootState = await lstat(absoluteRoot);
  if (!rootState.isDirectory() || rootState.isSymbolicLink()) {
    throw new Error(`site root must be a real directory: ${absoluteRoot}`);
  }
  assertPublicRelativePath(catalogFile);
  await assertReplaceableOutput(absoluteOutput);
  for (const file of hostedFileAllowlist) {
    await assertRegularSource(absoluteRoot, file);
  }
  await assertHostedStagingAssets(absoluteRoot);
  const [{ catalog }, transformed] = await Promise.all([
    loadHeldBuildInputs(absoluteRoot, catalogFile),
    transformedTruthSources(absoluteRoot),
  ]);

  const staging = `${absoluteOutput}.building-${randomUUID()}`;
  if (await pathState(staging)) {
    throw new Error(`hosted artifact staging path already exists: ${staging}`);
  }
  try {
    await writeHostedArtifact({
      absoluteRoot,
      staging,
      transformed,
      catalog,
      privacyV3Plan,
      jointLegalV3Plan,
      jointLegalV4Plan,
      jointLegalV5Plan,
      artifactFiles,
    });
    await verifyHostedArtifact({
      root: absoluteRoot,
      output: staging,
      privacyV3Render,
      jointLegalV3FinalizationRoot,
      jointLegalV4FinalizationRoot,
    });
    await promoteArtifact(staging, absoluteOutput);
  } catch (error) {
    if (await pathState(staging)) {
      await rm(staging, { recursive: true, force: true });
    }
    throw error;
  }
  return absoluteOutput;
}

function parseCli(argv) {
  const options = {};
  let check = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") {
      if (check) throw new Error("--check may be supplied only once");
      check = true;
    } else if (argument === "--output") {
      const value = argv[index + 1];
      if (!value) throw new Error("--output requires a path");
      options.output = value;
      index += 1;
    } else if (argument === "--catalog") {
      const value = argv[index + 1];
      if (!value) throw new Error("--catalog requires a relative file");
      options.catalogFile = value;
      index += 1;
    } else if (argument === "--joint-legal-v3-finalization") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--joint-legal-v3-finalization requires a directory");
      }
      options.jointLegalV3FinalizationRoot = value;
      index += 1;
    } else if (argument === "--joint-legal-v4-finalization") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--joint-legal-v4-finalization requires a directory");
      }
      options.jointLegalV4FinalizationRoot = value;
      index += 1;
    } else {
      throw new Error(`unknown build:hosted argument: ${argument}`);
    }
  }
  return { check, options };
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const { check, options } = parseCli(process.argv.slice(2));
  const operation = check ? verifyHostedArtifact : buildHostedArtifact;
  operation(options)
    .then((output) => {
      console.log(
        check
          ? `Hosted artifact verified at ${path.resolve(options.output ?? "_hosted")}`
          : `Hosted artifact built and verified at ${output}`,
      );
    })
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exitCode = 1;
    });
}
