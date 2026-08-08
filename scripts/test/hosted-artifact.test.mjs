import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  access,
  cp,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertHeldSourceTruth,
  assertHeldTruthSemantics,
  assertHostedAlakazamUiHeld,
  assertNoHeldAlakazamCopySemantics,
  assertNoHeldAlakazamExecutableSemantics,
  buildHostedArtifact,
  hostedFileAllowlist,
  hostedFilesForPrivacyV3Render,
  verifyHostedArtifact,
} from "../build-hosted.mjs";
import {
  buildPagesArtifact,
  publicFileAllowlist,
  verifyPagesArtifact,
} from "../build-pages.mjs";
import { hostedStagingAssets } from "../configure-abracadabra-hosted-staging.mjs";
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
} from "../hosted-truth/manifest.mjs";
import {
  assertImmutableLegalArtifactSources,
  assertLegalArtifactRelativePath,
  assertPrivacyV3CandidateSources,
  assertPrivacyV3ContentApprovalPending,
  assertPrivacyV3Unsealed,
  assertUnsealedPrivacyCurrentAlias,
  HOSTED_PRIVACY_V2_ARTIFACT,
  HOSTED_PRIVACY_V3_CANDIDATE,
  HOSTED_PRIVACY_V3_CONTENT,
  HOSTED_PRIVACY_V3_RELEASE,
  HOSTED_WEBSITE_TERMS_V2_ARTIFACT,
} from "../hosted-truth/legal-artifacts.mjs";
import {
  canonicalJson,
  finalizePrivacyV3,
} from "../hosted-truth/finalize-privacy-v3.mjs";
import {
  PRIVACY_V3_REVIEW_EFFECTIVE_LABEL,
  PRIVACY_V3_REVIEW_VERSION,
  renderPrivacyV3Review,
} from "../hosted-truth/render-privacy-v3-review.mjs";
import {
  PRIVACY_V3_CONTENT_APPROVAL_SCHEMA,
  PRIVACY_V3_CONTENT_APPROVAL_STATEMENT,
  PRIVACY_V3_CONTENT_SEAL_SCHEMA,
  PRIVACY_V3_CONTENT_TEMPLATE_TOKENS,
  readPrivacyV3ContentSeal,
  sealPrivacyV3Content,
  validatePrivacyV3ContentApproval,
  validatePrivacyV3ContentSeal,
} from "../hosted-truth/seal-privacy-v3-content.mjs";
import {
  PRIVACY_V3_AUTHORITY_SCHEMA,
  createPrivacyV3RenderPlan,
  normalizePrivacyV3FinalPage,
  PRIVACY_V3_OWNER_APPROVAL,
} from "../hosted-truth/privacy-v3-render.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const EXPECTED_HOSTED_STAGING_ASSETS = [
  "abracadabra/app/abracadabra-api.js",
  "abracadabra/app/abracadabra-billing-views.js",
  "abracadabra/app/abracadabra-control-mode.js",
  "abracadabra/app/abracadabra-customer-control-dom.js",
  "abracadabra/app/abracadabra-hosted-control.js",
];

const PRIVACY_TOPICS = [
  "operator",
  "public-pages",
  "accounts",
  "projects",
  "published-sites",
  "hive-planner",
  "network-records",
  "domains",
  "billing",
  "retention",
  "safety-support",
  "communications",
  "choices",
  "security",
  "changes",
  "contact",
];

const TERMS_TOPICS = [
  "acceptance",
  "self-service",
  "address-modes",
  "customer-domains",
  "billing-cancellation",
  "publication",
  "customer-content",
  "prohibited-uses",
  "safety-holds",
  "custom-work",
  "assessment",
  "hive-planner",
  "care",
  "site-ownership",
  "warranty",
  "limits",
  "changes-contact",
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function exactPrivacyV3ReviewApprovalFixture() {
  return {
    schema: PRIVACY_V3_CONTENT_APPROVAL_SCHEMA,
    statement: PRIVACY_V3_CONTENT_APPROVAL_STATEMENT,
    approvalReference: "TEST-ONLY-PRIVACY-V3-EXACT-REVIEW-APPROVAL",
    approvedAt: "2099-12-30T12:34:56.000Z",
    reviewArtifactSha256: HOSTED_PRIVACY_V3_CONTENT.reviewArtifactSha256,
    reviewArtifactByteCount: HOSTED_PRIVACY_V3_CONTENT.reviewArtifactByteCount,
  };
}

function marker(slot, edge) {
  return slot.kind === "html"
    ? `<!-- sitesourcery:truth-slot:${slot.id}:${edge} -->`
    : `/* sitesourcery:truth-slot:${slot.id}:${edge} */`;
}

function count(source, value) {
  return source.split(value).length - 1;
}

async function walk(directory, root = directory) {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name, "en-US"))) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(absolute, root));
    } else {
      files.push(path.relative(root, absolute).split(path.sep).join("/"));
    }
  }
  return files;
}

async function readTruthFiles(root, requirements) {
  return new Map(
    await Promise.all(
      Object.keys(requirements).map(async (file) => [
        file,
        await readFile(path.join(root, file), "utf8"),
      ]),
    ),
  );
}

async function readTextFiles(root, files) {
  return new Map(
    await Promise.all(
      files
        .filter((file) => /\.(?:html|js|json|xml|txt)$/u.test(file))
        .map(async (file) => [
          file,
          await readFile(path.join(root, file), "utf8"),
        ]),
    ),
  );
}

function assertRequirements(sources, requirements) {
  for (const [file, phrases] of Object.entries(requirements)) {
    const source = sources.get(file);
    for (const phrase of phrases) assert.ok(source.includes(phrase), `${file}: ${phrase}`);
  }
}

function assertMissingPhrases(sources, phrases) {
  for (const [file, source] of sources) {
    for (const phrase of phrases) {
      assert.equal(source.includes(phrase), false, `${file}: ${phrase}`);
    }
  }
}

function topicIds(source) {
  return [...source.matchAll(/<details\b[^>]*\bdata-legal-topic="([^"]+)"/gu)]
    .map((match) => match[1]);
}

function publicDollarValues(sources) {
  return [...sources].flatMap(([file, source]) =>
    [...source.matchAll(/\$(\d+(?:\.\d{2})?)/gu)]
      .map((match) => ({ file, value: match[1] })));
}

function publicEmails(sources) {
  return [...sources].flatMap(([file, source]) =>
    [...source.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/giu)]
      .map((match) => ({ email: match[0].toLocaleLowerCase("en-US"), file })));
}

test("reviewed truth inputs are unique, exact, and held mode exposes no hosted account surface", async () => {
  assert.equal(hostedTruthSlots.length, 13);
  assert.equal(
    new Set(hostedTruthSlots.map(({ id }) => id)).size,
    hostedTruthSlots.length,
  );
  assert.equal(
    new Set(hostedTruthSlots.map(({ hostedFragment }) => hostedFragment)).size,
    hostedTruthSlots.length,
  );
  assert.deepEqual(hostedCodeTransforms, []);
  assert.deepEqual(hostedStagingAssets, EXPECTED_HOSTED_STAGING_ASSETS);
  assert.deepEqual(Object.keys(hostedStagingAssetSha256), hostedStagingAssets);

  for (const hostedOnlyAsset of [
    "abracadabra/app/abracadabra-api.js",
    "abracadabra/app/abracadabra-billing-views.js",
    "abracadabra/app/abracadabra-customer-control-dom.js",
    "abracadabra/app/abracadabra-hosted-control.js",
  ]) {
    assert.equal(publicFileAllowlist.includes(hostedOnlyAsset), false);
    assert.equal(hostedFileAllowlist.includes(hostedOnlyAsset), true);
  }
  for (const heldSourceFile of heldAlakazamArtifactExcludedFiles) {
    assert.equal(publicFileAllowlist.includes(heldSourceFile), false);
    assert.equal(hostedFileAllowlist.includes(heldSourceFile), false);
  }
  for (const file of publicFileAllowlist.filter((candidate) =>
    /\.(?:html|js|json|xml|txt)$/u.test(candidate))) {
    const source = await readFile(path.join(ROOT, file), "utf8");
    assert.doesNotMatch(source, /https:\/\/buy\.stripe\.com\//u, file);
  }
  assert.equal(publicFileAllowlist.includes("domains/domain-prices.json"), false);
  assert.equal(hostedFileAllowlist.includes("domains/domain-prices.json"), false);
  assert.equal(publicFileAllowlist.includes("domains/domain-search.js"), true);
  assert.equal(hostedFileAllowlist.includes("domains/domain-search.js"), true);

  for (const slot of hostedTruthSlots) {
    const source = await readFile(path.join(ROOT, slot.file), "utf8");
    const start = marker(slot, "start");
    const end = marker(slot, "end");
    assert.equal(count(source, start), 1, `${slot.id} start`);
    assert.equal(count(source, end), 1, `${slot.id} end`);
    const startIndex = source.indexOf(start);
    const endIndex = source.indexOf(end);
    assert.ok(startIndex < endIndex, slot.id);
    assert.equal(
      sha256(source.slice(startIndex + start.length, endIndex)),
      slot.sourceSha256,
      `${slot.id} held digest`,
    );
    assert.equal(
      sha256(await readFile(path.join(ROOT, slot.hostedFragment), "utf8")),
      slot.hostedSha256,
      `${slot.id} hosted digest`,
    );
  }

  await assertHeldSourceTruth({ root: ROOT });
  assert.equal(assertPrivacyV3CandidateSources({ root: ROOT }), true);
  const privacySource = await readFile(
    path.join(ROOT, HOSTED_PRIVACY_V3_CANDIDATE.currentFile),
    "utf8",
  );
  assert.match(privacySource, /Not effective — release identity pending/u);
  assert.doesNotMatch(
    privacySource,
    /SS-HOSTED-PRIVACY-\d{4}-\d{2}-\d{2}-V3/u,
  );
  const sources = await readTruthFiles(ROOT, heldTruthRequirements);
  assertRequirements(sources, heldTruthRequirements);
  assertMissingPhrases(sources, hostedOnlyPhrases);
  for (const [file, phrases] of Object.entries(heldTruthForbiddenPhrases)) {
    const source = sources.get(file);
    for (const phrase of phrases) {
      assert.equal(source.includes(phrase), false, `${file}: ${phrase}`);
    }
  }

  for (const semantic of heldAlakazamExecutableSemantics) {
    const injected = new Map([[`injected-${semantic.id}.js`, semantic.example]]);
    assert.throws(
      () => assertNoHeldAlakazamExecutableSemantics(injected),
      new RegExp(`held Alakazam executable semantics ${semantic.id}`, "u"),
      semantic.id,
    );
  }

  const app = sources.get("abracadabra/app/index.html");
  assert.match(
    app,
    /<meta name="sitesourcery-abracadabra-control-mode" content="hold">/u,
  );
  assert.match(app, /abracadabra-control-mode\.js/u);
  assert.doesNotMatch(
    app,
    /data-customer-stage|data-create-account|data-request-recovery|data-request-download-quote/u,
  );
  assert.doesNotMatch(
    app,
    /abracadabra-(?:hosted-control|customer-control-dom)\.js|abracadabra-platform\.js/u,
  );
});

test("held truth semantic gate rejects every hosted-only or retired held-product claim", async () => {
  const sources = await readTruthFiles(ROOT, heldTruthRequirements);
  assert.equal(assertHeldTruthSemantics(sources), true);

  for (const phrase of hostedOnlyPhrases) {
    const [file] = sources.keys();
    const changed = new Map(sources);
    changed.set(file, `${sources.get(file)}\n${phrase}\n`);
    assert.throws(
      () => assertHeldTruthSemantics(changed),
      /contains hosted-only phrase/u,
      phrase,
    );
  }

  for (const [file, phrases] of Object.entries(heldTruthForbiddenPhrases)) {
    for (const phrase of phrases) {
      const changed = new Map(sources);
      changed.set(file, `${sources.get(file)}\n${phrase}\n`);
      assert.throws(
        () => assertHeldTruthSemantics(changed),
        /contains (?:hosted-only|retired held-product) phrase/u,
        `${file}: ${phrase}`,
      );
    }
  }
});

test("held Alakazam copy fragments and customer UI fail closed before release", async () => {
  const fragmentSources = new Map(
    await Promise.all(
      Object.keys(heldAlakazamCopyFragmentSha256).map(async (file) => [
        file,
        await readFile(path.join(ROOT, file), "utf8"),
      ]),
    ),
  );
  assert.equal(fragmentSources.size, 13);
  assert.equal(assertNoHeldAlakazamCopySemantics(fragmentSources), true);
  for (const semantic of heldAlakazamCopyForbiddenSemantics) {
    assert.throws(
      () => assertNoHeldAlakazamCopySemantics(new Map([
        [`injected-${semantic.id}.html`, semantic.example],
      ])),
      new RegExp(`held Alakazam customer claim ${semantic.id}`, "u"),
      semantic.id,
    );
  }

  assert.deepEqual(heldAlakazamCustomerArtifactFiles, [
    "abracadabra/app/index.html",
    "abracadabra/index.html",
    "faq/index.html",
    "index.html",
    "vnext.js",
  ]);
  const customerControl = await readFile(
    path.join(ROOT, "abracadabra/app/abracadabra-customer-control-dom.js"),
    "utf8",
  );
  assert.equal(assertHostedAlakazamUiHeld(customerControl), true);
});

test("one hosted build emits the exact $5 Download contract, customer controls, and no retired product", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "sitesourcery-hosted-artifact-"));
  t.after(async () => rm(temporary, { recursive: true, force: true }));
  const output = path.join(temporary, "artifact");

  assert.equal(await buildHostedArtifact({ root: ROOT, output }), output);
  await verifyHostedArtifact({ root: ROOT, output });
  assert.equal(assertImmutableLegalArtifactSources({ root: ROOT }), true);
  assert.equal(assertImmutableLegalArtifactSources({ root: output }), true);

  const v2ArchiveOutput = path.join(output, HOSTED_PRIVACY_V2_ARTIFACT.file);
  const exactV2Archive = await readFile(v2ArchiveOutput);
  assert.equal(exactV2Archive.length, HOSTED_PRIVACY_V2_ARTIFACT.byteCount);
  assert.equal(sha256(exactV2Archive), HOSTED_PRIVACY_V2_ARTIFACT.sha256);
  const termsV2ArchiveOutput = path.join(
    output,
    HOSTED_WEBSITE_TERMS_V2_ARTIFACT.file,
  );
  const exactTermsV2Archive = await readFile(termsV2ArchiveOutput);
  assert.equal(
    exactTermsV2Archive.length,
    HOSTED_WEBSITE_TERMS_V2_ARTIFACT.byteCount,
  );
  assert.equal(
    sha256(exactTermsV2Archive),
    HOSTED_WEBSITE_TERMS_V2_ARTIFACT.sha256,
  );
  assert.equal(assertUnsealedPrivacyCurrentAlias({ root: output }), true);
  assert.equal(
    (await readFile(
      path.join(output, HOSTED_PRIVACY_V3_CANDIDATE.currentFile),
    )).equals(exactV2Archive),
    true,
    "an ordinary unsealed hosted build must keep the current privacy alias on V2",
  );
  assert.equal(hostedFileAllowlist.includes(HOSTED_PRIVACY_V2_ARTIFACT.file), true);
  assert.equal(publicFileAllowlist.includes(HOSTED_PRIVACY_V2_ARTIFACT.file), true);
  assert.equal(
    hostedFileAllowlist.includes(HOSTED_WEBSITE_TERMS_V2_ARTIFACT.file),
    true,
  );
  assert.equal(
    publicFileAllowlist.includes(HOSTED_WEBSITE_TERMS_V2_ARTIFACT.file),
    true,
  );
  assert.equal(
    (await readFile(path.join(output, "sitemap.xml"), "utf8"))
      .includes(HOSTED_PRIVACY_V2_ARTIFACT.evidenceUri),
    false,
    "immutable legal evidence must stay out of the sitemap",
  );

  const tamperedV2Archive = Buffer.from(exactV2Archive);
  tamperedV2Archive[100] ^= 1;
  await writeFile(v2ArchiveOutput, tamperedV2Archive);
  await assert.rejects(
    verifyHostedArtifact({ root: ROOT, output }),
    /immutable legal artifact.*digest changed|digest changed/u,
  );
  await writeFile(v2ArchiveOutput, exactV2Archive);
  await verifyHostedArtifact({ root: ROOT, output });

  const tamperedTermsV2Archive = Buffer.from(exactTermsV2Archive);
  tamperedTermsV2Archive[100] ^= 1;
  await writeFile(termsV2ArchiveOutput, tamperedTermsV2Archive);
  await assert.rejects(
    verifyHostedArtifact({ root: ROOT, output }),
    /immutable legal artifact.*digest changed|digest changed/u,
  );
  await writeFile(termsV2ArchiveOutput, exactTermsV2Archive);
  await verifyHostedArtifact({ root: ROOT, output });

  const customerControlOutput = path.join(
    output,
    "abracadabra/app/abracadabra-customer-control-dom.js",
  );
  const exactCustomerControl = await readFile(customerControlOutput, "utf8");
  await writeFile(customerControlOutput, `${exactCustomerControl}\nchanged\n`, "utf8");
  await assert.rejects(
    verifyHostedArtifact({ root: ROOT, output }),
    /hosted artifact staging asset digest mismatch/u,
  );
  await writeFile(customerControlOutput, exactCustomerControl, "utf8");
  await verifyHostedArtifact({ root: ROOT, output });

  const files = (await walk(output)).sort();
  assert.deepEqual(files, [...hostedFileAllowlist]);
  for (const file of heldAlakazamArtifactExcludedFiles) {
    await assert.rejects(access(path.join(output, file)));
  }

  const sources = await readTruthFiles(output, hostedTruthRequirements);
  assertRequirements(sources, hostedTruthRequirements);
  assertMissingPhrases(sources, heldOnlyPhrases);
  for (const file of files.filter((candidate) =>
    candidate === "index.html" || candidate.endsWith("/index.html"))) {
    const source = await readFile(path.join(output, file), "utf8");
    if (/<meta\s+http-equiv="refresh"/iu.test(source)) continue;
    assert.match(
      source,
      /<main\b[^>]*\bid="main"[^>]*\btabindex="-1"/u,
      `${file}: skip-link main target must accept focus`,
    );
  }
  for (const source of sources.values()) {
    assert.equal(source.includes("sitesourcery:truth-slot:"), false);
    assert.equal(source.includes("/abracadabra/site/"), false);
  }

  const allText = await readTextFiles(output, files);
  for (const [file, source] of allText) {
    assert.doesNotMatch(source, /https:\/\/buy\.stripe\.com\//u, file);
  }
  const dollars = publicDollarValues(allText);
  assert.ok(dollars.length > 0);
  assert.ok(dollars.some(({ value }) => value === "5" || value === "5.00"));
  const emails = publicEmails(allText);
  assert.ok(emails.length > 0);
  for (const { email, file } of emails) {
    assert.equal(email, "sitesourcery@proton.me", file);
  }
  const app = sources.get("abracadabra/app/index.html");
  assert.ok(
    app.indexOf('id="workroom"') < app.indexOf('id="control-room"'),
    "hosted maker must precede account controls in DOM and visual order",
  );
  assert.equal(
    count(
      app,
      '<meta name="sitesourcery-abracadabra-control-mode" content="hosted">',
    ),
    1,
  );
  assert.doesNotMatch(app, /content="hold"/u);
  for (const asset of [
    "/abracadabra/app/abracadabra-api.js",
    "/abracadabra/app/abracadabra-hosted-control.js",
    "/abracadabra/app/abracadabra-app.js",
    "/abracadabra/app/abracadabra-customer-control-dom.js",
  ]) {
    assert.equal(count(app, asset), 1, asset);
  }
  assert.doesNotMatch(
    app,
    /abracadabra-hosted-catalog|abracadabra-account\.js|abracadabra-paid-download\.js|abracadabra-control\.js|abracadabra-hosted-control-dom\.js|abracadabra-platform\.js/u,
  );
  assert.doesNotMatch(app, /https:\/\/buy\.stripe\.com\//u);
  assert.doesNotMatch(
    app,
    /data-publish|data-domain-stage|data-save-address|data-save-access/u,
  );
  assert.doesNotMatch(app, /data-alakazam-account|customer-alakazam-account/u);
  assert.match(
    app,
    /href="\/contact\/#direct-contact">Contact Site Sourcery for account recovery<\/a>/u,
  );
  assert.deepEqual(
    [...app.matchAll(/data-customer-stage="([^"]+)"/gu)].map((match) => match[1]),
    ["account", "project", "quote", "download"],
  );
  assert.deepEqual(
    [...app.matchAll(/<fieldset class="spark-step" data-step="([^"]+)"/gu)]
      .map((match) => match[1]),
    ["vibe", "facts", "truth", "preview"],
  );
  for (const field of [
    "accountName",
    "organizationName",
    "accountEmail",
    "accountPassword",
  ]) {
    assert.equal(count(app, `name="${field}"`), 1, field);
  }
  assert.match(
    app,
    /name="acceptedProjectTerms"[\s\S]*I accept the <a href="\/legal\/website-terms\/"[^>]*>website terms<\/a>, including the <a href="\/legal\/website-terms\/#self-service"[^>]*>self-service product terms<\/a>, and acknowledge the <a href="\/legal\/privacy\/"[^>]*>privacy notice<\/a> for this project\./u,
  );
  assert.match(app, /\$5 once[\s\S]*No renewal[\s\S]*Your HTML file/u);
  assert.match(app, /Sign in for the \$5 Download\./u);
  assert.match(
    app,
    /Alakazam subscriptions and hosting activation remain held\./u,
  );
  assert.doesNotMatch(
    app,
    /Alakazam is the service that keeps it and puts it online|Your \$5 comes off Alakazam/u,
  );

  const landing = sources.get("abracadabra/index.html");
  assert.match(landing, /Abracadabra Alakazam/u);
  assert.match(landing, /Free to See-\$5 Account Download-Alakazam Plans Held/u);
  assert.match(
    landing,
    /Alakazam plans are in development\. Public subscriptions and hosting activation are held/u,
  );
  assert.match(landing, /<small>plans<\/small>held/u);
  assert.match(landing, /class="kd-live"><i><\/i>Held<\/span>/u);
  assert.doesNotMatch(
    landing,
    /\$25|Keeps It Live|Live at your own address|comes off your first month|leaving costs nothing|class="kd-live"><i><\/i>Live<\/span>/iu,
  );
  assert.ok(landing.indexOf("Abracadabra</p>") < landing.indexOf("Alakazam</p>"));
  assert.match(
    sources.get("abracadabra/how/index.html"),
    /http-equiv="refresh" content="0;url=\/abracadabra\/"/u,
  );

  const faq = sources.get("faq/index.html");
  for (const anchor of [
    "paths",
    "abracadabra-now",
    "address-choices",
    "private-sites",
    "missed-payment",
  ]) {
    assert.equal(count(faq, `id="${anchor}" data-faq-anchor="${anchor}"`), 1);
  }
  assert.match(
    faq,
    /The planned \$25, \$35, and \$50 Alakazam plans are not available\./u,
  );
  assert.match(
    faq,
    /No Alakazam subscription, hosting activation, publication, or tier feature is offered\./u,
  );
  assert.doesNotMatch(faq, /complete three-plan ladder is approved/iu);
  assert.match(faq, /The Responder is also held: it sends no messages and this page cannot quote or start setup\./u);
  assert.match(faq, /the final 50% becomes due after completion and before final handoff\./u);
  assert.match(faq, /It is not charged merely because completion was recorded\./u);
  assert.doesNotMatch(faq, /The Responder answers missed calls with a text in seconds/u);

  const responder = await readFile(path.join(output, "responder/index.html"), "utf8");
  for (const phrase of [
    "The Responder is not currently connected to a phone number, sending messages, or operating for customers.",
    "No setup or monthly plan is for sale.",
    "This is an inquiry page only.",
    "The Responder remains held.",
  ]) {
    assert.ok(responder.includes(phrase), phrase);
  }
  assert.doesNotMatch(
    responder,
    /\$300|\$250|within seconds|Texts in seconds|switch it off whenever you like/iu,
  );

  const privacy = sources.get("legal/privacy/index.html");
  const terms = sources.get("legal/website-terms/index.html");
  assert.deepEqual(topicIds(privacy), PRIVACY_TOPICS);
  assert.deepEqual(topicIds(terms), TERMS_TOPICS);
  for (const phrase of [
    "$5 once per editor project unlocks Download for that project.",
    "Later accepted versions and repeat downloads from the same retained editor project do not require another Site Sourcery purchase.",
    "A different editor project has its own one-time $5 Download unlock.",
    "The customer may modify it and self-host it without another Site Sourcery payment.",
    "Made-for-you design, writing, migration, integrations, domain help, and publishing need a separate written scope.",
    "Hive is a short phone or in-person conversation with Zack",
  ]) {
    assert.ok(terms.includes(phrase), phrase);
  }
  for (const legalSource of [privacy, terms]) {
    assert.match(legalSource, /href="tel:\+18562441220">\(856\) 244-1220<\/a>/u);
    assert.match(
      legalSource,
      /href="mailto:sitesourcery@proton\.me">sitesourcery@proton\.me<\/a>/u,
    );
    assert.doesNotMatch(
      legalSource,
      /\b(?:cancel anytime|refund within|retained for \d+ days?|Rent|Owned \+ managed)\b/iu,
    );
  }

  const commercialControl = JSON.parse(
    await readFile(path.join(ROOT, "data/abracadabra-commercial-control.json"), "utf8"),
  );
  const releaseControl = JSON.parse(
    await readFile(path.join(ROOT, "data/release-control.json"), "utf8"),
  );
  assert.equal(commercialControl.checkout.enabled, false);
  assert.equal(commercialControl.domainCheckout.enabled, false);
  assert.equal(commercialControl.costPolicy.providerPurchasesAuthorized, false);
  assert.equal(releaseControl.allowsDeployment, false);
  assert.equal(releaseControl.allowsCommercialDeployment, false);
});

test("an ordinary public build cannot publish the unsealed privacy V3 candidate", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "sitesourcery-privacy-v3-public-hold-"));
  t.after(async () => rm(temporary, { recursive: true, force: true }));
  const output = path.join(temporary, "artifact");

  assert.equal(buildPagesArtifact({ root: ROOT, output }), output);
  assert.equal(verifyPagesArtifact({ root: ROOT, output }).output, output);
  assert.equal(assertUnsealedPrivacyCurrentAlias({ root: output }), true);

  const [sourceCandidate, publishedCurrent, publishedV2] = await Promise.all([
    readFile(path.join(ROOT, HOSTED_PRIVACY_V3_CANDIDATE.currentFile)),
    readFile(path.join(output, HOSTED_PRIVACY_V3_CANDIDATE.currentFile)),
    readFile(path.join(output, HOSTED_PRIVACY_V2_ARTIFACT.file)),
  ]);
  assert.equal(sourceCandidate.equals(publishedCurrent), false);
  assert.equal(publishedCurrent.equals(publishedV2), true);
  assert.equal(sha256(publishedCurrent), HOSTED_PRIVACY_V2_ARTIFACT.sha256);
  assert.equal(
    (await walk(output)).some((file) =>
      /^legal\/privacy\/versions\/SS-HOSTED-PRIVACY-\d{4}-\d{2}-\d{2}-V3\/index\.html$/u.test(file)),
    false,
  );
});

test("every nullable privacy V3 release field independently fails closed", () => {
  const sentinels = {
    version: "UNAPPROVED-V3-TEST",
    versionedFile: "legal/privacy/versions/UNAPPROVED-V3-TEST/index.html",
    effectiveAt: "UNAPPROVED-UTC-TEST",
    fullPageSha256: "0".repeat(64),
    byteCount: 1,
    authorityDigest: "1".repeat(64),
  };

  assert.equal(assertPrivacyV3Unsealed(), true);
  for (const [field, value] of Object.entries(sentinels)) {
    const release = { ...HOSTED_PRIVACY_V3_RELEASE, [field]: value };
    assert.deepEqual(
      Object.keys(sentinels).filter((candidate) => release[candidate] !== null),
      [field],
    );
    assert.throws(
      () => assertPrivacyV3Unsealed(release),
      /must remain explicitly unsealed/u,
      `${field} must independently fail closed`,
    );
  }
});

test("privacy V3 clause/layout review stays unsealed and outside production artifacts", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "sitesourcery-privacy-v3-review-test-"));
  t.after(async () => rm(temporary, { recursive: true, force: true }));
  const outputRoot = path.join(temporary, "review");

  assert.equal(assertPrivacyV3Unsealed(), true);
  assert.deepEqual(HOSTED_PRIVACY_V3_RELEASE, {
    state: "unsealed",
    kind: "privacy",
    currentFile: "legal/privacy/index.html",
    version: null,
    versionedFile: null,
    effectiveAt: null,
    fullPageSha256: null,
    byteCount: null,
    authorityDigest: null,
  });
  assert.equal(assertPrivacyV3ContentApprovalPending(), true);
  assert.deepEqual(HOSTED_PRIVACY_V3_CONTENT, {
    state: "review-frozen-approval-pending",
    published: false,
    deployable: false,
    reviewArtifactSha256:
      "1fdc50606115e31e61aad1063e724949f0e2efb3444aaba775a7db9c14523a14",
    reviewArtifactByteCount: 25_994,
    contentTemplateSha256:
      "8bc347cf8c0755d7e923fef60f5c481660ee37ca3dd1bbaa1df4f1371a018bfc",
    contentTemplateByteCount: 25_763,
    approvalReceiptSha256: null,
    contentSealSha256: null,
  });

  const review = await renderPrivacyV3Review({ root: ROOT, outputRoot });
  const current = await readFile(
    path.join(outputRoot, review.receipt.currentFile),
  );
  const versioned = await readFile(
    path.join(outputRoot, review.receipt.versionedFile),
  );
  assert.equal(current.equals(versioned), true);
  assert.equal(review.receipt.state, "unsealed");
  assert.equal(review.receipt.sealable, false);
  assert.equal(review.receipt.deployable, false);
  assert.equal(
    review.receipt.approvalState,
    "exact-review-artifact-approval-pending",
  );
  assert.equal(review.receipt.renderPath, "real-hosted-builder");
  assert.equal(review.receipt.version, null);
  assert.equal(review.receipt.effectiveAt, null);
  assert.equal(review.receipt.fullPageSha256, null);
  assert.equal(review.receipt.byteCount, null);
  assert.equal(review.receipt.authorityDigest, null);
  assert.equal(
    review.receipt.reviewArtifactSha256,
    HOSTED_PRIVACY_V3_CONTENT.reviewArtifactSha256,
  );
  assert.equal(
    review.receipt.reviewArtifactByteCount,
    HOSTED_PRIVACY_V3_CONTENT.reviewArtifactByteCount,
  );
  assert.equal(
    review.receipt.expectedReviewArtifactSha256,
    HOSTED_PRIVACY_V3_CONTENT.reviewArtifactSha256,
  );
  assert.equal(
    review.receipt.expectedReviewArtifactByteCount,
    HOSTED_PRIVACY_V3_CONTENT.reviewArtifactByteCount,
  );
  assert.equal(sha256(current), HOSTED_PRIVACY_V3_CONTENT.reviewArtifactSha256);
  assert.equal(current.byteLength, HOSTED_PRIVACY_V3_CONTENT.reviewArtifactByteCount);
  await verifyHostedArtifact({
    root: ROOT,
    output: path.join(outputRoot, "hosted"),
    privacyV3Render: { mode: "review" },
  });
  assert.deepEqual(
    (await walk(path.join(outputRoot, "hosted"))).sort(),
    [...hostedFilesForPrivacyV3Render({ mode: "review" })],
  );

  const source = current.toString("utf8");
  assert.ok(source.includes(PRIVACY_V3_REVIEW_VERSION));
  assert.ok(source.includes(PRIVACY_V3_REVIEW_EFFECTIVE_LABEL));
  assert.match(source, /<meta name="robots" content="noindex,nofollow">/u);
  assert.match(source, /must not be used to seal release constants/u);
  assert.doesNotMatch(source, /Effective August 6, 2026/u);
  assert.doesNotMatch(source, /SS-HOSTED-PRIVACY-\d{4}-\d{2}-\d{2}-V3/u);
  assert.doesNotMatch(source, /sitesourcery:truth-slot:/u);
  assert.doesNotMatch(source, /Privacy V3 clause-review source/u);

  for (const file of [...publicFileAllowlist, ...hostedFileAllowlist]) {
    assert.doesNotMatch(
      file,
      /^legal\/privacy\/versions\/SS-HOSTED-PRIVACY-\d{4}-\d{2}-\d{2}-V3\/index\.html$/u,
    );
  }
});

test("privacy V3 content seal freezes exact approved review bytes without inventing release authority", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "sitesourcery-privacy-v3-content-seal-test-"));
  t.after(async () => rm(temporary, { recursive: true, force: true }));
  const approvalReceipt = exactPrivacyV3ReviewApprovalFixture();
  assert.deepEqual(
    validatePrivacyV3ContentApproval(approvalReceipt),
    approvalReceipt,
  );

  const firstOutput = path.join(temporary, "first");
  const secondOutput = path.join(temporary, "second");
  const first = await sealPrivacyV3Content({
    root: ROOT,
    outputRoot: firstOutput,
    approvalReceipt,
  });
  const second = await sealPrivacyV3Content({
    root: ROOT,
    outputRoot: secondOutput,
    approvalReceipt,
  });
  const [firstReceiptBytes, secondReceiptBytes] = await Promise.all([
    readFile(path.join(firstOutput, "privacy-v3-content-seal.json")),
    readFile(path.join(secondOutput, "privacy-v3-content-seal.json")),
  ]);
  assert.equal(firstReceiptBytes.equals(secondReceiptBytes), true);
  assert.deepEqual(first.receipt, second.receipt);
  assert.deepEqual(
    await readPrivacyV3ContentSeal(
      path.join(firstOutput, "privacy-v3-content-seal.json"),
    ),
    first.receipt,
  );

  const receipt = JSON.parse(firstReceiptBytes.toString("utf8"));
  assert.equal(receipt.schema, PRIVACY_V3_CONTENT_SEAL_SCHEMA);
  assert.equal(receipt.state, "content-approved-unreleased");
  assert.equal(receipt.published, false);
  assert.equal(receipt.deployable, false);
  assert.equal(receipt.releaseFinalizationRequired, true);
  assert.deepEqual(receipt.release, {
    version: null,
    effectiveAt: null,
    fullPageSha256: null,
    byteCount: null,
    artifactUri: null,
    authorityDigest: null,
  });
  assert.equal(
    receipt.approvalReceiptSha256,
    sha256(canonicalJson(approvalReceipt)),
  );
  const receiptBody = { ...receipt };
  delete receiptBody.contentSealSha256;
  assert.equal(
    receipt.contentSealSha256,
    sha256(canonicalJson(receiptBody)),
  );

  const [reviewCurrent, reviewVersioned, templateCurrent, templateVersioned] =
    await Promise.all([
      readFile(path.join(firstOutput, receipt.reviewArtifact.file)),
      readFile(path.join(firstOutput, receipt.reviewArtifact.versionedFile)),
      readFile(path.join(firstOutput, receipt.contentTemplate.file)),
      readFile(path.join(firstOutput, receipt.contentTemplate.versionedFile)),
    ]);
  assert.equal(reviewCurrent.equals(reviewVersioned), true);
  assert.equal(templateCurrent.equals(templateVersioned), true);
  assert.equal(sha256(reviewCurrent), receipt.reviewArtifact.sha256);
  assert.equal(reviewCurrent.byteLength, receipt.reviewArtifact.byteCount);
  assert.equal(sha256(templateCurrent), receipt.contentTemplate.sha256);
  assert.equal(templateCurrent.byteLength, receipt.contentTemplate.byteCount);
  assert.match(
    templateCurrent.toString("utf8"),
    new RegExp(PRIVACY_V3_CONTENT_TEMPLATE_TOKENS.version, "u"),
  );
  assert.match(
    templateCurrent.toString("utf8"),
    new RegExp(PRIVACY_V3_CONTENT_TEMPLATE_TOKENS.effectiveLabel, "u"),
  );
  assert.doesNotMatch(
    templateCurrent.toString("utf8"),
    /SS-HOSTED-PRIVACY-\d{4}-\d{2}-\d{2}-V3|Effective [A-Z][a-z]+ \d{1,2}, \d{4}/u,
  );
  await verifyHostedArtifact({
    root: ROOT,
    output: path.join(firstOutput, "template-hosted"),
    privacyV3Render: { mode: "content-template" },
  });

  for (const mutation of [
    { ...approvalReceipt, reviewArtifactSha256: "0".repeat(64) },
    { ...approvalReceipt, reviewArtifactByteCount: approvalReceipt.reviewArtifactByteCount + 1 },
    { ...approvalReceipt, unexpected: true },
  ]) {
    assert.throws(
      () => validatePrivacyV3ContentApproval(mutation),
      /must bind exact owner approval to the exact review artifact/u,
    );
  }

  const invalidOutput = path.join(temporary, "invalid-approval");
  await assert.rejects(
    sealPrivacyV3Content({
      root: ROOT,
      outputRoot: invalidOutput,
      approvalReceipt: { ...approvalReceipt, unexpected: true },
    }),
    /must bind exact owner approval to the exact review artifact/u,
  );
  await assert.rejects(access(invalidOutput));

  const tamperedDigest = JSON.parse(JSON.stringify(receipt));
  tamperedDigest.contentSealSha256 = "0".repeat(64);
  assert.throws(
    () => validatePrivacyV3ContentSeal(tamperedDigest),
    /content seal digest changed/u,
  );
  const tamperedTemplate = JSON.parse(JSON.stringify(receipt));
  tamperedTemplate.contentTemplate.sha256 = "0".repeat(64);
  assert.throws(
    () => validatePrivacyV3ContentSeal(tamperedTemplate),
    /content template binding is invalid/u,
  );
  const releaseAmbiguous = JSON.parse(JSON.stringify(receipt));
  releaseAmbiguous.release.version = "UNAPPROVED-V3-TEST";
  assert.throws(
    () => validatePrivacyV3ContentSeal(releaseAmbiguous),
    /must contain no release constants/u,
  );
  const pathTraversal = JSON.parse(JSON.stringify(receipt));
  pathTraversal.reviewArtifact.file = "../review.html";
  assert.throws(
    () => validatePrivacyV3ContentSeal(pathTraversal),
    /invalid immutable legal artifact path/u,
  );
  const safeMisdirection = JSON.parse(JSON.stringify(receipt));
  safeMisdirection.reviewArtifact.file = "review/hosted/legal/privacy/moved.html";
  const safeMisdirectionBody = { ...safeMisdirection };
  delete safeMisdirectionBody.contentSealSha256;
  safeMisdirection.contentSealSha256 = sha256(
    canonicalJson(safeMisdirectionBody),
  );
  assert.throws(
    () => validatePrivacyV3ContentSeal(safeMisdirection),
    /review artifact binding is invalid/u,
  );
});

test("privacy V3 finalizer requires exact owner inputs and deterministically emits integration constants", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "sitesourcery-privacy-v3-finalizer-test-"));
  t.after(async () => rm(temporary, { recursive: true, force: true }));
  const version = "SS-HOSTED-PRIVACY-2099-12-31-V3";
  const effectiveAt = "2099-12-31T00:00:00.000Z";
  const missingApproval = path.join(temporary, "missing-approval");
  const mismatchedDate = path.join(temporary, "mismatched-date");

  await assert.rejects(
    finalizePrivacyV3({
      root: ROOT,
      outputRoot: missingApproval,
      version,
      effectiveAt,
    }),
    /owner-approved exact matching version and canonical UTC values/u,
  );
  await assert.rejects(access(missingApproval));
  await assert.rejects(
    finalizePrivacyV3({
      root: ROOT,
      outputRoot: mismatchedDate,
      version,
      effectiveAt: "2100-01-01T00:00:00.000Z",
      ownerApproval: PRIVACY_V3_OWNER_APPROVAL,
    }),
    /owner-approved exact matching version and canonical UTC values/u,
  );
  await assert.rejects(access(mismatchedDate));

  const contentSealOutput = path.join(temporary, "content-seal");
  const sealedContent = await sealPrivacyV3Content({
    root: ROOT,
    outputRoot: contentSealOutput,
    approvalReceipt: exactPrivacyV3ReviewApprovalFixture(),
  });
  const contentSealFile = path.join(
    contentSealOutput,
    "privacy-v3-content-seal.json",
  );
  const missingContentSeal = path.join(temporary, "missing-content-seal");
  await assert.rejects(
    finalizePrivacyV3({
      root: ROOT,
      outputRoot: missingContentSeal,
      version,
      effectiveAt,
      ownerApproval: PRIVACY_V3_OWNER_APPROVAL,
    }),
    /requires exactly one content seal source/u,
  );
  await assert.rejects(access(missingContentSeal));

  const tamperedContentSeal = JSON.parse(JSON.stringify(sealedContent.receipt));
  tamperedContentSeal.contentSealSha256 = "0".repeat(64);
  const tamperedContentSealOutput = path.join(temporary, "tampered-content-seal");
  await assert.rejects(
    finalizePrivacyV3({
      root: ROOT,
      outputRoot: tamperedContentSealOutput,
      version,
      effectiveAt,
      ownerApproval: PRIVACY_V3_OWNER_APPROVAL,
      contentSeal: tamperedContentSeal,
    }),
    /content seal digest changed/u,
  );
  await assert.rejects(access(tamperedContentSealOutput));

  const firstOutput = path.join(temporary, "first");
  const secondOutput = path.join(temporary, "second");
  const options = {
    root: ROOT,
    version,
    effectiveAt,
    ownerApproval: PRIVACY_V3_OWNER_APPROVAL,
  };
  const first = await finalizePrivacyV3({
    ...options,
    outputRoot: firstOutput,
    contentSeal: sealedContent.receipt,
  });
  const second = await finalizePrivacyV3({
    ...options,
    outputRoot: secondOutput,
    contentSealFile,
  });
  const [firstReceiptBytes, secondReceiptBytes] = await Promise.all([
    readFile(path.join(firstOutput, "privacy-v3-release-constants.json")),
    readFile(path.join(secondOutput, "privacy-v3-release-constants.json")),
  ]);
  assert.equal(firstReceiptBytes.equals(secondReceiptBytes), true);
  assert.deepEqual(first.receipt, second.receipt);

  const receipt = JSON.parse(firstReceiptBytes.toString("utf8"));
  const [current, versioned] = await Promise.all(
    receipt.artifacts.map(({ file }) => readFile(path.join(firstOutput, file))),
  );
  assert.equal(current.equals(versioned), true);
  assert.equal(receipt.fullPageSha256, sha256(current));
  assert.equal(receipt.byteCount, current.byteLength);
  assert.equal(receipt.schema, "sitesourcery.hosted-privacy-v3-finalization/v2");
  assert.equal(receipt.state, "owner-approved-finalization");
  assert.equal(receipt.sealable, true);
  assert.equal(receipt.published, false);
  assert.equal(receipt.integrationRequired, true);
  assert.equal(receipt.version, version);
  assert.equal(receipt.effectiveAt, effectiveAt);
  assert.deepEqual(receipt.contentSeal, {
    schema: sealedContent.receipt.schema,
    state: sealedContent.receipt.state,
    contentSealSha256: sealedContent.receipt.contentSealSha256,
    approvalReceiptSchema: sealedContent.receipt.approvalReceipt.schema,
    approvalStatement: sealedContent.receipt.approvalReceipt.statement,
    approvalReceiptSha256: sealedContent.receipt.approvalReceiptSha256,
    approvalReference: sealedContent.receipt.approvalReceipt.approvalReference,
    approvedAt: sealedContent.receipt.approvalReceipt.approvedAt,
    reviewArtifactSha256: sealedContent.receipt.reviewArtifact.sha256,
    reviewArtifactByteCount: sealedContent.receipt.reviewArtifact.byteCount,
    contentTemplateSha256: sealedContent.receipt.contentTemplate.sha256,
    contentTemplateByteCount: sealedContent.receipt.contentTemplate.byteCount,
  });
  assert.equal(
    receipt.authorityDigest,
    sha256(canonicalJson({
      documents: receipt.documents,
      schema: PRIVACY_V3_AUTHORITY_SCHEMA,
    })),
  );
  assert.deepEqual(receipt.environment, {
    SITESOURCERY_HOSTED_PRIVACY_V3_VERSION: version,
    SITESOURCERY_HOSTED_PRIVACY_V3_SHA256: receipt.fullPageSha256,
    SITESOURCERY_HOSTED_PRIVACY_V3_URI: receipt.artifactUri,
    SITESOURCERY_HOSTED_PRIVACY_V3_EFFECTIVE_AT: effectiveAt,
    SITESOURCERY_HOSTED_PRIVACY_V3_BYTE_COUNT: String(receipt.byteCount),
    SITESOURCERY_HOSTED_PRIVACY_V3_ARTIFACT_URI: receipt.artifactUri,
    SITESOURCERY_HOSTED_PRIVACY_V3_AUTHORITY_SHA256: receipt.authorityDigest,
  });
  const finalSource = current.toString("utf8");
  assert.match(finalSource, new RegExp(version, "u"));
  assert.match(finalSource, /Effective December 31, 2099/u);
  assert.doesNotMatch(finalSource, /noindex|unsealed|CLAUSE-LAYOUT-REVIEW/u);
  const normalizedFinal = Buffer.from(
    normalizePrivacyV3FinalPage(
      finalSource,
      createPrivacyV3RenderPlan({
        mode: "final",
        version,
        effectiveAt,
        ownerApproval: PRIVACY_V3_OWNER_APPROVAL,
      }),
    ),
    "utf8",
  );
  assert.equal(
    sha256(normalizedFinal),
    receipt.contentSeal.contentTemplateSha256,
  );
  assert.equal(
    normalizedFinal.byteLength,
    receipt.contentSeal.contentTemplateByteCount,
  );
  await verifyHostedArtifact({
    root: ROOT,
    output: path.join(firstOutput, "hosted"),
    privacyV3Render: {
      mode: "final",
      version,
      effectiveAt,
      ownerApproval: PRIVACY_V3_OWNER_APPROVAL,
    },
  });

  await writeFile(path.join(firstOutput, receipt.artifacts[1].file), `${versioned}\n`);
  await assert.rejects(
    verifyHostedArtifact({
      root: ROOT,
      output: path.join(firstOutput, "hosted"),
      privacyV3Render: {
        mode: "final",
        version,
        effectiveAt,
        ownerApproval: PRIVACY_V3_OWNER_APPROVAL,
      },
    }),
    /current and versioned bytes differ/u,
  );
});

test("missing, changed, or mixed reviewed input fails before replacing the last good artifact", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "sitesourcery-hosted-mutation-"));
  t.after(async () => rm(temporary, { recursive: true, force: true }));
  const fixture = path.join(temporary, "source");
  const output = path.join(temporary, "artifact");
  const excluded = new Set([".git", "_hosted", "_site", "node_modules"]);
  await cp(ROOT, fixture, {
    recursive: true,
    filter(source) {
      return !excluded.has(path.basename(source));
    },
  });

  const appFile = path.join(fixture, "abracadabra/app/index.html");
  const fragmentFile = path.join(
    fixture,
    "scripts/hosted-truth/fragments/abracadabra-app-hero.html",
  );
  const privacyFragmentFile = path.join(
    fixture,
    HOSTED_PRIVACY_V3_CANDIDATE.mainFragment,
  );
  const customerControlFile = path.join(
    fixture,
    "abracadabra/app/abracadabra-customer-control-dom.js",
  );
  const originalApp = await readFile(appFile, "utf8");
  const originalFragment = await readFile(fragmentFile, "utf8");
  const originalPrivacyFragment = await readFile(privacyFragmentFile, "utf8");
  const originalCustomerControl = await readFile(customerControlFile, "utf8");
  const v2ArchiveFile = path.join(fixture, HOSTED_PRIVACY_V2_ARTIFACT.file);
  const originalV2Archive = await readFile(v2ArchiveFile);
  const changedV2Archive = Buffer.from(originalV2Archive);
  changedV2Archive[100] ^= 1;

  for (const invalidPath of [
    "../privacy/index.html",
    "/legal/privacy/index.html",
    "legal/privacy/../privacy/index.html",
    "legal\\privacy\\index.html",
  ]) {
    assert.throws(
      () => assertLegalArtifactRelativePath(invalidPath),
      /invalid immutable legal artifact path/u,
    );
  }

  await writeFile(v2ArchiveFile, changedV2Archive);
  await assert.rejects(
    buildHostedArtifact({ root: fixture, output }),
    /digest changed/u,
  );
  await assert.rejects(access(output));
  await writeFile(v2ArchiveFile, originalV2Archive);

  const versionsDirectory = path.dirname(path.dirname(v2ArchiveFile));
  const realVersionsDirectory = `${versionsDirectory}-real`;
  await rename(versionsDirectory, realVersionsDirectory);
  await symlink(realVersionsDirectory, versionsDirectory, "dir");
  assert.throws(
    () => assertImmutableLegalArtifactSources({ root: fixture }),
    /traverses a symbolic link/u,
  );
  await assert.rejects(
    buildHostedArtifact({ root: fixture, output }),
    /traverses a symbolic link/u,
  );
  await assert.rejects(access(output));
  await rm(versionsDirectory);
  await rename(realVersionsDirectory, versionsDirectory);

  await writeFile(
    appFile,
    originalApp.replace(
      '<h1 id="spark-title">Abracadabra Alakazam</h1>',
      '<h1 id="spark-title">Changed product</h1>',
    ),
    "utf8",
  );
  await assert.rejects(
    buildHostedArtifact({ root: fixture, output }),
    /held truth changed without reviewed manifest update/u,
  );
  await assert.rejects(access(output));
  await writeFile(appFile, originalApp, "utf8");

  await writeFile(fragmentFile, `${originalFragment}\nchanged\n`, "utf8");
  await assert.rejects(
    buildHostedArtifact({ root: fixture, output }),
    /hosted truth changed without reviewed manifest update/u,
  );
  await assert.rejects(access(output));
  await writeFile(fragmentFile, originalFragment, "utf8");

  await writeFile(
    privacyFragmentFile,
    `${originalPrivacyFragment}\nchanged\n`,
    "utf8",
  );
  await assert.rejects(
    buildHostedArtifact({ root: fixture, output }),
    /privacy V3 candidate fragment does not match source slot/u,
  );
  await assert.rejects(access(output));
  await writeFile(privacyFragmentFile, originalPrivacyFragment, "utf8");

  await writeFile(customerControlFile, `${originalCustomerControl}\nchanged\n`, "utf8");
  await assert.rejects(
    buildHostedArtifact({ root: fixture, output }),
    /hosted staging asset changed without reviewed manifest update/u,
  );
  await assert.rejects(access(output));
  await writeFile(customerControlFile, originalCustomerControl, "utf8");

  const startMarker =
    "<!-- sitesourcery:truth-slot:abracadabra-app-hero:start -->";
  await writeFile(appFile, originalApp.replace(startMarker, ""), "utf8");
  await assert.rejects(
    buildHostedArtifact({ root: fixture, output }),
    /truth slot markers must each appear once/u,
  );
  await assert.rejects(access(output));
  await writeFile(appFile, originalApp, "utf8");

  await buildHostedArtifact({ root: fixture, output });
  const lastGood = await readFile(
    path.join(output, "abracadabra/app/index.html"),
    "utf8",
  );
  const lastGoodV2Archive = await readFile(
    path.join(output, HOSTED_PRIVACY_V2_ARTIFACT.file),
  );
  const lastGoodPrivacyCurrent = await readFile(
    path.join(output, HOSTED_PRIVACY_V3_CANDIDATE.currentFile),
  );
  await writeFile(
    privacyFragmentFile,
    `${originalPrivacyFragment}\nchanged after last good\n`,
    "utf8",
  );
  await assert.rejects(
    buildHostedArtifact({ root: fixture, output }),
    /privacy V3 candidate fragment does not match source slot/u,
  );
  assert.equal(
    (await readFile(path.join(output, HOSTED_PRIVACY_V3_CANDIDATE.currentFile)))
      .equals(lastGoodPrivacyCurrent),
    true,
    "invalid V3 candidate input must preserve the last complete V2 current alias",
  );
  await writeFile(privacyFragmentFile, originalPrivacyFragment, "utf8");
  await writeFile(v2ArchiveFile, changedV2Archive);
  await assert.rejects(
    buildHostedArtifact({ root: fixture, output }),
    /digest changed/u,
  );
  assert.equal(
    (await readFile(path.join(output, HOSTED_PRIVACY_V2_ARTIFACT.file)))
      .equals(lastGoodV2Archive),
    true,
    "invalid source evidence must preserve the last complete V2 artifact",
  );
  await writeFile(v2ArchiveFile, originalV2Archive);
  await writeFile(
    appFile,
    originalApp.replace(
      "Saving and payment are unavailable here.",
      "Use a changed account instruction",
    ),
    "utf8",
  );
  await assert.rejects(
    buildHostedArtifact({ root: fixture, output }),
    /held truth changed without reviewed manifest update/u,
  );
  assert.equal(
    await readFile(path.join(output, "abracadabra/app/index.html"), "utf8"),
    lastGood,
    "failed build must preserve the last complete artifact",
  );
});
