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
  buildHostedArtifact,
  hostedFileAllowlist,
  verifyHostedArtifact,
} from "../build-hosted.mjs";
import { publicFileAllowlist } from "../build-pages.mjs";
import { hostedStagingAssets } from "../configure-abracadabra-hosted-staging.mjs";
import {
  heldOnlyPhrases,
  heldTruthRequirements,
  hostedOnlyPhrases,
  hostedTruthRequirements,
  hostedTruthSlots,
} from "../hosted-truth/manifest.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const EXACT_LOCAL_BOUNDARY =
  "This build does not create an online account, take payment, register or connect a domain, or publish.";

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

test("reviewed truth slots are unique, exact, and the held source contains only held copy", async () => {
  assert.equal(hostedTruthSlots.length, 26);
  assert.equal(
    new Set(hostedTruthSlots.map(({ id }) => id)).size,
    hostedTruthSlots.length,
  );
  assert.equal(
    new Set(hostedTruthSlots.map(({ hostedFragment }) => hostedFragment)).size,
    hostedTruthSlots.length,
  );
  assert.equal(
    publicFileAllowlist.includes("abracadabra/app/abracadabra-control.js"),
    false,
  );
  assert.equal(
    hostedStagingAssets.includes("abracadabra/app/abracadabra-control.js"),
    true,
  );
  for (const heldViewerFile of [
    "abracadabra/platform/abracadabra-platform.js",
    "abracadabra/site/index.html",
    "abracadabra/site/viewer.css",
    "abracadabra/site/viewer.js",
  ]) {
    assert.equal(publicFileAllowlist.includes(heldViewerFile), true);
    assert.equal(hostedFileAllowlist.includes(heldViewerFile), false);
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

  const app = sources.get("abracadabra/app/index.html");
  assert.equal(count(app, EXACT_LOCAL_BOUNDARY), 1);
  assert.match(
    app,
    /<meta name="sitesourcery-abracadabra-control-mode" content="hold">/u,
  );
  assert.doesNotMatch(app, /class="platform-control"|data-open-account|data-save-direction/u);
  assert.doesNotMatch(
    app,
    /data-request-recovery|recoveryEmail|Recover account access/u,
    "held local maker must expose no account-recovery surface",
  );
  assert.match(app, /abracadabra-control-mode\.js/u);
  assert.doesNotMatch(
    app,
    /abracadabra-(?:control|hosted-control|hosted-control-dom)\.js|abracadabra-platform\.js/u,
  );
});

test("one hosted build emits the exact ledger, one truth variant, hosted controls, and no local viewer", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "sitesourcery-hosted-artifact-"));
  t.after(async () => rm(temporary, { recursive: true, force: true }));
  const output = path.join(temporary, "artifact");

  assert.equal(await buildHostedArtifact({ root: ROOT, output }), output);
  await verifyHostedArtifact({ root: ROOT, output });

  const hostedDomOutput = path.join(
    output,
    "abracadabra/app/abracadabra-hosted-control-dom.js",
  );
  const exactHostedDomOutput = await readFile(hostedDomOutput, "utf8");
  await writeFile(hostedDomOutput, `${exactHostedDomOutput}\nchanged\n`, "utf8");
  await assert.rejects(
    verifyHostedArtifact({ root: ROOT, output }),
    /hosted artifact staging asset digest mismatch/u,
  );
  await writeFile(hostedDomOutput, exactHostedDomOutput, "utf8");
  await verifyHostedArtifact({ root: ROOT, output });

  assert.deepEqual((await walk(output)).sort(), [...hostedFileAllowlist]);
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
  for (const source of sources.values()) {
    assert.equal(source.includes("sitesourcery:truth-slot:"), false);
    assert.equal(source.includes("/abracadabra/site/"), false);
  }

  const app = sources.get("abracadabra/app/index.html");
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
    "/abracadabra/app/abracadabra-hosted-control-dom.js",
    "/abracadabra/app/abracadabra-control.js",
  ]) {
    assert.ok(app.includes(asset), asset);
  }
  assert.doesNotMatch(app, /abracadabra-platform\.js/u);
  assert.doesNotMatch(
    app,
    /Internal lifecycle test|Test plan state|Test missed payment|Test suspension|Test deletion|data-internal-control/iu,
  );

  const catalogJson = app.match(
    /<script id="abracadabra-hosted-catalog" type="application\/json">([^<]+)<\/script>/u,
  )?.[1];
  assert.ok(catalogJson);
  const catalog = JSON.parse(catalogJson);
  assert.deepEqual(Object.keys(catalog.products), ["spark"]);
  assert.equal(
    catalog.products.spark.implementationContract,
    "abracadabra.spark/v1",
  );
  assert.deepEqual(Object.keys(catalog.offers), [
    "spark.rent",
    "spark.own",
    "spark.owned_managed",
  ]);
  assert.deepEqual(
    catalog.offers["spark.own"].eligibleAddressModes,
    ["customer_owned"],
  );
  assert.equal(JSON.stringify(catalog).includes("priceId"), false);
  assert.equal(JSON.stringify(catalog).includes("amountMinor"), false);

  const journey = [
    "<h3>Account</h3>",
    "<h3>Project Name</h3>",
    "<h3>Address</h3>",
    "<h3>Access</h3>",
    "<h3>Offer &amp; tenure</h3>",
    "<h3>Quote &amp; payment</h3>",
    "<h3>Verified address</h3>",
    "<h3>Reviewed version</h3>",
    "<h3>Publish</h3>",
  ];
  for (const route of [
    "abracadabra/index.html",
    "abracadabra/how/index.html",
  ]) {
    const journeySource = sources.get(route);
    let cursor = -1;
    for (const step of journey) {
      const next = journeySource.indexOf(step);
      assert.ok(next > cursor, `${route}: ${step}`);
      cursor = next;
    }
  }

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

  const terms = sources.get("legal/website-terms/index.html");
  const hostedApp = sources.get("abracadabra/app/index.html");
  assert.match(
    hostedApp,
    /href="\/contact\/#direct-contact">Contact Site Sourcery for account recovery<\/a>/u,
  );
  assert.doesNotMatch(
    [...sources.values()].join("\n"),
    /\bOwn \+ managed\b/u,
    "the third tenure must stay named Owned + managed on every hosted surface",
  );
  for (const topic of [
    "account",
    "provider",
    "serving",
    "payment",
    "Rent",
    "Own",
    "Owned + managed",
    "domain",
    "support",
    "safety",
    "export",
    "deletion",
  ]) {
    assert.ok(
      terms.toLocaleLowerCase("en-US").includes(
        topic.toLocaleLowerCase("en-US"),
      ),
      topic,
    );
  }

  const control = await readFile(
    path.join(output, "abracadabra/app/abracadabra-control.js"),
    "utf8",
  );
  assert.match(control, /^\(function \(root, factory\) \{/u);
  assert.doesNotMatch(
    control,
    /SiteSourceryAbracadabraPlatform|localStorage|\/abracadabra\/site\//u,
  );

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

  const homeFile = path.join(fixture, "index.html");
  const fragmentFile = path.join(
    fixture,
    "scripts/hosted-truth/fragments/home-abracadabra-card.html",
  );
  const originalHome = await readFile(homeFile, "utf8");
  const originalFragment = await readFile(fragmentFile, "utf8");
  const hostedDomFile = path.join(
    fixture,
    "abracadabra/app/abracadabra-hosted-control-dom.js",
  );
  const originalHostedDom = await readFile(hostedDomFile, "utf8");

  await writeFile(
    homeFile,
    originalHome.replace("Works in this browser", "Works somewhere"),
    "utf8",
  );
  await assert.rejects(
    buildHostedArtifact({ root: fixture, output }),
    /held truth changed without reviewed manifest update/u,
  );
  await assert.rejects(access(output));
  await writeFile(homeFile, originalHome, "utf8");

  await writeFile(fragmentFile, `${originalFragment}\nchanged\n`, "utf8");
  await assert.rejects(
    buildHostedArtifact({ root: fixture, output }),
    /hosted truth changed without reviewed manifest update/u,
  );
  await assert.rejects(access(output));
  await writeFile(fragmentFile, originalFragment, "utf8");

  await writeFile(hostedDomFile, `${originalHostedDom}\nchanged\n`, "utf8");
  await assert.rejects(
    buildHostedArtifact({ root: fixture, output }),
    /hosted staging asset changed without reviewed manifest update/u,
  );
  await assert.rejects(access(output));
  await writeFile(hostedDomFile, originalHostedDom, "utf8");

  const startMarker =
    "<!-- sitesourcery:truth-slot:home-abracadabra-card:start -->";
  await writeFile(homeFile, originalHome.replace(startMarker, ""), "utf8");
  await assert.rejects(
    buildHostedArtifact({ root: fixture, output }),
    /truth slot markers must each appear once/u,
  );
  await assert.rejects(access(output));
  await writeFile(homeFile, originalHome, "utf8");

  await buildHostedArtifact({ root: fixture, output });
  const lastGood = await readFile(path.join(output, "index.html"), "utf8");
  await writeFile(
    homeFile,
    originalHome.replace(
      "It does not put the site online or take payment.",
      "Everything is live.",
    ),
    "utf8",
  );
  await assert.rejects(
    buildHostedArtifact({ root: fixture, output }),
    /held truth changed without reviewed manifest update/u,
  );
  assert.equal(
    await readFile(path.join(output, "index.html"), "utf8"),
    lastGood,
    "failed build must preserve the last complete artifact",
  );
});
