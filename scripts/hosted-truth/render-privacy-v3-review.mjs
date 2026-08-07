#!/usr/bin/env node

import { lstat, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertPrivacyV3Unsealed } from "./legal-artifacts.mjs";

export const PRIVACY_V3_REVIEW_VERSION =
  "SS-HOSTED-PRIVACY-CLAUSE-LAYOUT-REVIEW-DRAFT-V3";
export const PRIVACY_V3_REVIEW_EFFECTIVE_LABEL =
  "Not effective — clause and layout review only";

const SOURCE_FILE = "legal/privacy/index.html";
const CURRENT_REVIEW_FILE = "current/legal/privacy/index.html";
const VERSIONED_REVIEW_FILE =
  `versioned/legal/privacy/versions/${PRIVACY_V3_REVIEW_VERSION}/index.html`;
const PROVISIONAL_ASIDE = [
  '<p class="card-kicker">Effective August 6, 2026</p>',
  '<h2>This notice covers the public site, guest preview, account, and Download.</h2>',
  '<p>Free guest work stays in the current tab. A signed-in customer can retain an editor project and its $5 Download. Alakazam subscriptions remain held.</p>',
].join("");
const DESCRIPTION_TAG =
  "<meta name=\"description\" content=\"How Site Sourcery handles public pages, the free guest preview, accounts, saved projects, $5 Download, domain preflight, and held services.\">";
const BODY_TAG = '<body class="vnext-page legal-page privacy-page">';
const REVIEW_ASIDE = [
  `<p class="card-kicker">${PRIVACY_V3_REVIEW_EFFECTIVE_LABEL}</p>`,
  `<h2>Notice ${PRIVACY_V3_REVIEW_VERSION}</h2>`,
  "<p>This is not the final hosted artifact and must not be used to seal release constants. The final version date, effective UTC time, full-page digest, and authority digest are intentionally unset.</p>",
].join("");

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== ""
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function occurrences(source, value) {
  return source.split(value).length - 1;
}

function renderReviewSource(source) {
  if (
    occurrences(source, PROVISIONAL_ASIDE) !== 1
    || occurrences(source, DESCRIPTION_TAG) !== 1
    || occurrences(source, BODY_TAG) !== 1
  ) {
    throw new Error("privacy V3 clause/layout source no longer has the reviewed render anchors");
  }
  let rendered = source.replace(PROVISIONAL_ASIDE, REVIEW_ASIDE);
  rendered = rendered.replace(
    DESCRIPTION_TAG,
    `${DESCRIPTION_TAG}\n  <meta name="robots" content="noindex,nofollow">`,
  );
  rendered = rendered.replace(
    BODY_TAG,
    '<body class="vnext-page legal-page privacy-page" data-privacy-v3-review-state="unsealed">',
  );
  rendered = rendered.replace(
    /^\s*<!-- sitesourcery:truth-slot:legal-privacy-(?:head|main):(?:start|end) -->\n?/gmu,
    "",
  );
  if (
    rendered.includes("Effective August 6, 2026")
    || /SS-HOSTED-PRIVACY-\d{4}-\d{2}-\d{2}-V3/u.test(rendered)
    || !rendered.includes(PRIVACY_V3_REVIEW_EFFECTIVE_LABEL)
    || !rendered.includes(PRIVACY_V3_REVIEW_VERSION)
  ) {
    throw new Error("privacy V3 clause/layout render contains sealed or stale authority identity");
  }
  return rendered;
}

async function assertOutputDoesNotExist(outputRoot) {
  try {
    await lstat(outputRoot);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`privacy V3 review output already exists: ${outputRoot}`);
}

export async function renderPrivacyV3Review({
  root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
  outputRoot,
} = {}) {
  assertPrivacyV3Unsealed();
  const absoluteRoot = path.resolve(root);
  const absoluteOutput = outputRoot
    ? path.resolve(outputRoot)
    : await mkdtemp(path.join(tmpdir(), "sitesourcery-privacy-v3-clause-layout-review-"));
  if (absoluteOutput === absoluteRoot || isInside(absoluteRoot, absoluteOutput)) {
    throw new Error("privacy V3 review output must remain outside the repository");
  }
  if (outputRoot) {
    await assertOutputDoesNotExist(absoluteOutput);
    await mkdir(absoluteOutput, { recursive: false });
  }

  const source = await readFile(path.join(absoluteRoot, SOURCE_FILE), "utf8");
  const activeHostedPrivacy = await readFile(
    path.join(absoluteRoot, "scripts/hosted-truth/fragments/legal-privacy-main.html"),
    "utf8",
  );
  if (
    !activeHostedPrivacy.includes("SS-HOSTED-PRIVACY-2026-07-30-V2")
    || activeHostedPrivacy.includes("SS-HOSTED-PRIVACY-CLAUSE-LAYOUT-REVIEW-DRAFT-V3")
  ) {
    throw new Error(
      "clause/layout review renderer is disabled after hosted privacy truth convergence",
    );
  }
  const rendered = renderReviewSource(source);
  for (const file of [CURRENT_REVIEW_FILE, VERSIONED_REVIEW_FILE]) {
    const destination = path.join(absoluteOutput, ...file.split("/"));
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, rendered, "utf8");
  }
  const receipt = Object.freeze({
    schema: "sitesourcery.hosted-privacy-v3-clause-layout-review/v1",
    state: "unsealed",
    sealable: false,
    version: null,
    effectiveAt: null,
    fullPageSha256: null,
    byteCount: null,
    authorityDigest: null,
    reviewLabel: PRIVACY_V3_REVIEW_VERSION,
    limitation:
      "Clause/layout review only. Final exact-byte review must use converged V3 truth through the real hosted builder.",
    currentFile: CURRENT_REVIEW_FILE,
    versionedFile: VERSIONED_REVIEW_FILE,
  });
  await writeFile(
    path.join(absoluteOutput, "review.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
    "utf8",
  );
  return Object.freeze({ outputRoot: absoluteOutput, rendered, receipt });
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const outputArgument = process.argv[2];
  if (process.argv.length > 3) {
    console.error("Usage: node scripts/hosted-truth/render-privacy-v3-review.mjs [new-output-directory]");
    process.exitCode = 2;
  } else {
    renderPrivacyV3Review({ outputRoot: outputArgument })
      .then(({ outputRoot }) => console.log(outputRoot))
      .catch((error) => {
        console.error(error.stack || error.message);
        process.exitCode = 1;
      });
  }
}
