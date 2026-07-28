export const CONTAINMENT_PRODUCTION_SHA = "eff8195640db58390d03eefbe863248220994e37";

export const CONTAINMENT_TARGETS = Object.freeze([
  "the-meter.html",
  "the-moat.html",
  "the-responder.html",
]);

const FULL_COMMIT = /^[0-9a-f]{40}$/u;
const EXACT_ROOT_FILE = /^[a-z0-9][a-z0-9-]*\.html$/u;

export function assertContainmentTarget(productionSha, removePath) {
  if (!FULL_COMMIT.test(productionSha ?? "")) {
    throw new Error("production SHA must be one full lowercase commit");
  }
  if (!EXACT_ROOT_FILE.test(removePath ?? "")) {
    throw new Error("containment target must be one exact lowercase root HTML file");
  }
  if (productionSha !== CONTAINMENT_PRODUCTION_SHA) {
    throw new Error("containment authority does not cover this production commit");
  }
  if (!CONTAINMENT_TARGETS.includes(removePath)) {
    throw new Error("containment authority does not cover this public route");
  }
  return removePath;
}
