import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  access,
  cp,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertHeldSourceTruth,
  assertHeldTruthSemantics,
  buildHostedArtifact,
  hostedFileAllowlist,
  verifyHostedArtifact,
} from "../build-hosted.mjs";
import { publicFileAllowlist } from "../build-pages.mjs";
import { hostedStagingAssets } from "../configure-abracadabra-hosted-staging.mjs";
import {
  heldOnlyPhrases,
  heldTruthForbiddenPhrases,
  heldTruthRequirements,
  hostedCodeTransforms,
  hostedOnlyPhrases,
  hostedStagingAssetSha256,
  hostedTruthRequirements,
  hostedTruthSlots,
} from "../hosted-truth/manifest.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const EXPECTED_HOSTED_STAGING_ASSETS = [
  "abracadabra/app/abracadabra-api.js",
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
    "abracadabra/app/abracadabra-customer-control-dom.js",
    "abracadabra/app/abracadabra-hosted-control.js",
  ]) {
    assert.equal(publicFileAllowlist.includes(hostedOnlyAsset), false);
    assert.equal(hostedFileAllowlist.includes(hostedOnlyAsset), true);
  }
  for (const heldViewerFile of [
    "abracadabra/platform/abracadabra-platform.js",
    "abracadabra/site/index.html",
    "abracadabra/site/viewer.css",
    "abracadabra/site/viewer.js",
  ]) {
    assert.equal(publicFileAllowlist.includes(heldViewerFile), true);
    assert.equal(hostedFileAllowlist.includes(heldViewerFile), false);
  }
  for (const browserBridgeFile of [
    "abracadabra/app/abracadabra-account.js",
    "abracadabra/app/abracadabra-paid-download.js",
  ]) {
    assert.equal(publicFileAllowlist.includes(browserBridgeFile), true);
    assert.equal(hostedFileAllowlist.includes(browserBridgeFile), false);
  }

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
  const sources = await readTruthFiles(ROOT, heldTruthRequirements);
  assertRequirements(sources, heldTruthRequirements);
  assertMissingPhrases(sources, hostedOnlyPhrases);
  for (const [file, phrases] of Object.entries(heldTruthForbiddenPhrases)) {
    const source = sources.get(file);
    for (const phrase of phrases) {
      assert.equal(source.includes(phrase), false, `${file}: ${phrase}`);
    }
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

test("one hosted build emits the exact $5 Download contract, customer controls, and no retired product", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "sitesourcery-hosted-artifact-"));
  t.after(async () => rm(temporary, { recursive: true, force: true }));
  const output = path.join(temporary, "artifact");

  assert.equal(await buildHostedArtifact({ root: ROOT, output }), output);
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
  for (const file of [
    "abracadabra/site/index.html",
    "abracadabra/site/viewer.css",
    "abracadabra/site/viewer.js",
    "abracadabra/platform/abracadabra-platform.js",
  ]) {
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
  const dollars = publicDollarValues(allText);
  assert.ok(dollars.length > 0);
  assert.ok(dollars.some(({ value }) => value === "5" || value === "5.00"));
  assert.ok(dollars.some(({ value }) => value === "25" || value === "25.00"));
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
  assert.match(app, /\$5 once[\s\S]*No renewal[\s\S]*Your HTML file/u);

  const landing = sources.get("abracadabra/index.html");
  assert.match(landing, /Abracadabra Alakazam/u);
  assert.match(landing, /Free to See-\$5 to Download-\$25 a Month Keeps It Live/u);
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
  const customerControlFile = path.join(
    fixture,
    "abracadabra/app/abracadabra-customer-control-dom.js",
  );
  const originalApp = await readFile(appFile, "utf8");
  const originalFragment = await readFile(fragmentFile, "utf8");
  const originalCustomerControl = await readFile(customerControlFile, "utf8");

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
  await writeFile(
    appFile,
    originalApp.replace(
      "Your page downloads for $5",
      "Your page downloads for a changed amount",
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
