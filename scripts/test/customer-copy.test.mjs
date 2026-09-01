import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  CUSTOMER_COPY_ROUTES,
  analyzeCustomerCopySource,
  inspectCustomerCopy,
  validateCustomerCopyAnalysis,
} from "../check-customer-copy.mjs";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = path.resolve(TEST_DIRECTORY, "../..");
const HOME_CONFIG = CUSTOMER_COPY_ROUTES.find(({ route }) => route === "/");

async function homeErrors(mutate) {
  const source = await readFile(path.join(SITE_ROOT, HOME_CONFIG.file), "utf8");
  const changed = mutate(source);
  const analysis = analyzeCustomerCopySource(HOME_CONFIG.file, changed, HOME_CONFIG);
  return validateCustomerCopyAnalysis(analysis, HOME_CONFIG);
}

test("assigned customer routes pass the customer-copy gate", async () => {
  const result = await inspectCustomerCopy(SITE_ROOT);
  assert.equal(result.ok, true, result.errors.join("\n"));
});

test("customer-copy gate rejects internal jargon", async () => {
  const errors = await homeErrors((source) =>
    source.replace("</main>", "<p>The control plane is ready.</p></main>"));
  assert.match(errors.join("\n"), /control-plane jargon/u);
});

test("customer-copy gate rejects internal availability labels", async () => {
  const errors = await homeErrors((source) =>
    source.replace("</main>", "<p>This offer is held and inquiry-only.</p></main>"));
  assert.match(errors.join("\n"), /internal held-state label/u);
  assert.match(errors.join("\n"), /inquiry-only label/u);
});

test("customer-copy gate rejects an overlong heading", async () => {
  const errors = await homeErrors((source) =>
    source.replace(
      "<h1>Look good online. Stop losing leads.</h1>",
      "<h1>This heading has far too many words for a person scanning the website quickly on a phone today</h1>",
    ));
  assert.match(errors.join("\n"), /heading is \d+ words/u);
});

test("customer-copy gate rejects an overlong paragraph", async () => {
  const longParagraph = `<p>${"word ".repeat(71).trim()}</p>`;
  const errors = await homeErrors((source) => source.replace("</main>", `${longParagraph}</main>`));
  assert.match(errors.join("\n"), /paragraph is 71 words/u);
});

test("customer-copy gate keeps one clear hero action", async () => {
  const errors = await homeErrors((source) =>
    source.replace(
      '<p class="hero-tagline">WEBSITE MAGIC-<a href="tel:+18562441220">ONE CALL AWAY</a></p>',
      '<p class="hero-tagline">WEBSITE MAGIC-<a href="tel:+18562441220">ONE CALL AWAY</a><a href="/contact/">Contact</a></p>',
    ));
  assert.match(errors.join("\n"), /must offer 1 useful link/u);
});
