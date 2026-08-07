import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { publicFileAllowlist } from "../build-pages.mjs";
import { heldAlakazamArtifactExcludedFiles } from "../hosted-truth/manifest.mjs";
import {
  OFFER_AVAILABILITY,
  SELLABLE,
  readiness,
  sellableNow,
} from "../../server/commerce/rails.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("inquiry-only catalog releases no implicit public Checkout rails", async () => {
  const catalog = JSON.parse(
    await readFile(path.join(ROOT, "data/public-catalog.json"), "utf8")
  );
  assert.equal(catalog.offerState, "inquiry-only");
  assert.deepEqual(sellableNow(), []);

  assert.deepEqual(
    Object.fromEntries(SELLABLE.map((offer) => [offer.id, offer.availability])),
    {
      "abracadabra.preview": OFFER_AVAILABILITY.ACCOUNT_ONLY,
      "alacazam.hosting": OFFER_AVAILABILITY.HELD,
      "domain.purchase": OFFER_AVAILABILITY.INQUIRY_ONLY,
      "domain.purchase.plus": OFFER_AVAILABILITY.INQUIRY_ONLY,
      assessment: OFFER_AVAILABILITY.ACCOUNT_ONLY,
      responder: OFFER_AVAILABILITY.HELD,
      "custom.build": OFFER_AVAILABILITY.INQUIRY_ONLY,
    },
  );

  const allowedAvailability = new Set(Object.values(OFFER_AVAILABILITY));
  assert.equal(new Set(SELLABLE.map((offer) => offer.id)).size, SELLABLE.length);
  for (const offer of SELLABLE) {
    assert.equal(
      allowedAvailability.has(offer.availability),
      true,
      `${offer.id} availability`
    );
  }

  for (const id of ["abracadabra.preview", "assessment"]) {
    const offer = SELLABLE.find((candidate) => candidate.id === id);
    assert.equal(offer.rail, "checkout_session", id);
    assert.equal(offer.checkoutUrl, null, id);
    assert.equal(offer.productRef, null, id);
    assert.equal(offer.priceRef, null, id);
  }
  assert.deepEqual(readiness().needsServer, ["abracadabra.preview", "assessment"]);

  const held = SELLABLE.filter((offer) =>
    offer.availability === OFFER_AVAILABILITY.HELD
  );
  for (const offer of held) {
    assert.equal(offer.amountCents, null, offer.id);
    assert.equal(offer.checkoutUrl, null, offer.id);
    assert.equal(offer.productRef, null, offer.id);
    assert.equal(offer.priceRef, null, offer.id);
  }
});

test("domain offers have inquiry authority but no direct provider checkout authority", () => {
  for (const id of ["domain.purchase", "domain.purchase.plus"]) {
    const offer = SELLABLE.find((candidate) => candidate.id === id);
    assert.ok(offer, id);
    assert.equal(offer.availability, OFFER_AVAILABILITY.INQUIRY_ONLY);
    assert.equal(offer.checkoutUrl, null);
    assert.equal(offer.productRef, null);
    assert.equal(offer.priceRef, null);
  }
});

test("public Domains surface is DNS preflight plus inquiry only", async () => {
  const [page, search] = await Promise.all([
    readFile(path.join(ROOT, "domains/index.html"), "utf8"),
    readFile(path.join(ROOT, "domains/domain-search.js"), "utf8"),
  ]);

  assert.match(page, /Domain registration is inquiry-only\./u);
  assert.match(page, /public-DNS preflight/u);
  assert.match(page, /This page cannot accept payment\./u);
  assert.match(search, /Ask to verify /u);
  assert.match(
    search,
    /not a reservation, registrar result, quote, or authorization to buy/u
  );

  for (const source of [page, search]) {
    assert.doesNotMatch(source, /buy\.stripe\.com/u);
    assert.doesNotMatch(source, /refund in full/iu);
  }
  assert.doesNotMatch(page, /\$(?:40|45)\b/u);
  assert.doesNotMatch(search, /domain-prices\.json|CHECKOUT_BY_BAND|rent an address/iu);
  assert.equal(publicFileAllowlist.includes("domains/domain-prices.json"), false);
  assert.equal(publicFileAllowlist.includes("domains/domain-search.js"), true);
  assert.equal(
    publicFileAllowlist.includes("abracadabra/app/abracadabra-account.js"),
    false,
  );
  assert.equal(
    publicFileAllowlist.includes("abracadabra/app/abracadabra-paid-download.js"),
    false,
  );
  for (const file of heldAlakazamArtifactExcludedFiles) {
    assert.equal(publicFileAllowlist.includes(file), false, file);
  }
});

test("held offers cannot return through the landing, home, or flyer", async () => {
  const [landing, home, flyer] = await Promise.all([
    readFile(path.join(ROOT, "abracadabra/index.html"), "utf8"),
    readFile(path.join(ROOT, "index.html"), "utf8"),
    readFile(path.join(ROOT, "flyer.html"), "utf8"),
  ]);

  assert.match(landing, /Free to See-\$5 Account Download-Alakazam Plans Held/u);
  assert.match(home, /Abracadabra builds it\. Alakazam is still held\./u);
  assert.match(home, /No setup or monthly plan is for sale/u);
  assert.match(flyer, /Alakazam and The Responder remain held\./u);
  assert.match(flyer, /one qualifying Custom base build/u);

  for (const source of [landing, home, flyer]) {
    assert.doesNotMatch(source, /\$(?:25|250|300)\b/u);
    assert.doesNotMatch(
      source,
      /Keeps It Live|keeps it live|Live at your own address|leaving costs nothing|texts them back|Answers in seconds|Buy a domain|comes off any build/iu,
    );
  }
});
