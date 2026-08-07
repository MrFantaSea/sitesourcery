import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  WORK_PUBLIC_TRUTH,
  analyzeWorkPublicTruth,
  validateWorkPublicTruth,
} from "../work-public-truth.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WORK_FILE = path.join(ROOT, "work/index.html");
const source = await readFile(WORK_FILE, "utf8");

function messages(mutated) {
  return validateWorkPublicTruth(mutated).join("\n");
}

test("current Work page proves exactly two founder-owned ventures and two fictional studies", () => {
  const analysis = analyzeWorkPublicTruth(source);
  assert.deepEqual(
    [...analysis.founderOwnedProjectIds].sort(),
    [...WORK_PUBLIC_TRUTH.founderOwnedProjectIds].sort(),
  );
  assert.deepEqual(
    [...analysis.fictionalStudyIds].sort(),
    [...WORK_PUBLIC_TRUTH.fictionalStudyIds].sort(),
  );
  assert.equal(analysis.inventedClientResult, null);
  assert.deepEqual(validateWorkPublicTruth(source), []);
});

test("Work truth fails when a third founder-owned venture is introduced", () => {
  const mutated = source.replace(
    "</main>",
    '<article class="portfolio-project" id="third-founder"><p class="project-label-live">Founder-owned venture</p><p>Not client work.</p></article></main>',
  );
  assert.match(messages(mutated), /founder-owned projects must be exactly/u);
});

test("Work truth fails when either founder-owned label disappears", () => {
  const mutated = source.replace("Founder-owned venture", "Portfolio website");
  assert.match(messages(mutated), /founder-owned projects must be exactly/u);
});

test("Work truth fails when either study loses its explicit fictional label", () => {
  const mutated = source.replace("Fictional design study", "Design study");
  assert.match(messages(mutated), /fictional studies must be exactly/u);
});

test("Work truth fails when a fictional evidence marker becomes a client result", () => {
  const mutated = source.replace(
    'data-evidence-kind="fictional-design-study"',
    'data-evidence-kind="client-result"',
  );
  assert.match(messages(mutated), /fictional study trattoria must retain|client result/u);
});

test("Work truth fails on an invented client-result claim", () => {
  const mutated = source.replace("</main>", "<p>Our clients doubled their sales.</p></main>");
  assert.match(messages(mutated), /invented client-result claim/u);
});

test("Work truth fails when founder-owned proof is relabeled as client work", () => {
  const mutated = source.replace(
    'data-proof-state="verified-founder-owned"',
    'data-proof-state="client-work"',
  );
  assert.match(messages(mutated), /cannot be relabeled as client work/u);
});
