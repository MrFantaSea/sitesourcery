import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  ABRACADABRA_V1_STALE_ASSUMPTION_INVENTORY,
  LEGACY_VNEXT_RULE_INVENTORY,
  legacyValidationCalls,
  validateCheckerAuthority,
  validateInventoryParity,
} from "../checker-authority.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const legacySource = await readFile(path.join(ROOT, "scripts/check-site-vnext.mjs"), "utf8");

test("every archived vNext rule entry point has one explicit authority decision", async () => {
  const calls = LEGACY_VNEXT_RULE_INVENTORY.flatMap(({ legacyCalls }) => legacyCalls).sort();
  assert.equal(calls.length, 34);
  assert.deepEqual(calls, legacyValidationCalls(legacySource));
  assert.equal(ABRACADABRA_V1_STALE_ASSUMPTION_INVENTORY.length, 5);
  assert.deepEqual(
    ABRACADABRA_V1_STALE_ASSUMPTION_INVENTORY.map(({ disposition }) => disposition),
    ["retired", "retired", "retired", "retired", "retired"],
  );
  assert.deepEqual(await validateCheckerAuthority(ROOT), []);
});

test("parity proof fails if the archived checker gains an uninventoried rule", () => {
  const mutated = legacySource.replace(
    "await check404(absoluteRoot, availableSourceFiles, errors);",
    "await checkNewPublic404Rule(absoluteRoot, availableSourceFiles, errors);",
  );
  assert.match(
    validateInventoryParity(mutated).join("\n"),
    /missing from inventory: checkNewPublic404Rule/u,
  );
  assert.match(
    validateInventoryParity(mutated).join("\n"),
    /absent from legacy validation: check404/u,
  );
});
