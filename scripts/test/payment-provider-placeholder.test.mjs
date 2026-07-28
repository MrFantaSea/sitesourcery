import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { publicFileAllowlist } from "../build-pages.mjs";
import { PAYMENT_PROVIDER_SLOT } from "../payment-provider-placeholder.mjs";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = path.resolve(SCRIPT_DIRECTORY, "../..");

test("payment provider seam is exactly inert and provider-neutral", () => {
  assert.deepEqual(PAYMENT_PROVIDER_SLOT, {
    schema: "sitesourcery.payment-provider-slot.v1",
    provider: null,
    adapter: null,
    checkout: null,
    liveMode: false,
  });
  assert.equal(Object.isFrozen(PAYMENT_PROVIDER_SLOT), true);
});

test("payment placeholder is source-only and cannot enter the public artifact", () => {
  assert.equal(publicFileAllowlist.includes("scripts/payment-provider-placeholder.mjs"), false);
});

test("payment placeholder contains no endpoint, secret, product, price, or network effect", async () => {
  const source = await readFile(
    path.join(SITE_ROOT, "scripts/payment-provider-placeholder.mjs"),
    "utf8",
  );
  for (const forbidden of [
    /https?:\/\//u,
    /\bfetch\s*\(/u,
    /\bXMLHttpRequest\b/u,
    /\bWebSocket\b/u,
    /\b(?:sk|pk|rk)_(?:test|live)_/u,
    /\b(?:price|prod|pi|cs)_[A-Za-z0-9]+/u,
    /\b(?:stripe|paypal|braintree|square)\b/iu,
  ]) {
    assert.doesNotMatch(source, forbidden);
  }
});
