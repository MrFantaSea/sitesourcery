import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildHostedArtifact } from "../build-hosted.mjs";
import {
  PUBLIC_ROUTE_SECTION_LEDGER,
  REMAINING_LEDGER_ROUTES,
  validateCustomerSectionLedger,
} from "../customer-section-ledger.mjs";
import {
  CANONICAL_ROUTES,
  routeToFile,
} from "../check-routes.mjs";
import { loadCustomerSectionRouteSources } from "../check-customer-section-ledger.mjs";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = path.resolve(TEST_DIRECTORY, "../..");

function cloneSources(sources) {
  return new Map(
    [...sources].map(([routeName, entry]) => [
      routeName,
      typeof entry === "string" ? entry : { ...entry },
    ]),
  );
}

function mutateRoute(sources, routeName, mutate) {
  const mutated = cloneSources(sources);
  const current = mutated.get(routeName);
  assert.ok(current && typeof current !== "string");
  const nextSource = mutate(current.source);
  assert.notEqual(nextSource, current.source, `mutation did not change ${routeName}`);
  mutated.set(routeName, { ...current, source: nextSource });
  return mutated;
}

function detailsBlock(source, id) {
  const match = source.match(
    new RegExp(`<details id="${id}"[^>]*>[\\s\\S]*?</details>`, "u"),
  );
  assert.ok(match, `missing FAQ block ${id}`);
  return match[0];
}

function swap(source, first, second) {
  assert.notEqual(first, second);
  const token = "<!-- customer-section-ledger-swap -->";
  assert.equal(source.includes(token), false);
  return source
    .replace(first, token)
    .replace(second, first)
    .replace(token, second);
}

function assertFailure(failures, fragment) {
  assert.ok(
    failures.some((failure) => failure.includes(fragment)),
    `expected a failure containing ${JSON.stringify(fragment)}:\n${failures.join("\n")}`,
  );
}

async function loadHostedRouteSources(t) {
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "sitesourcery-section-ledger-test-"),
  );
  t.after(() => rm(temporaryRoot, { force: true, recursive: true }));
  const output = path.join(temporaryRoot, "artifact");
  await buildHostedArtifact({ output, root: SITE_ROOT });
  return new Map(
    await Promise.all(
      Object.entries(PUBLIC_ROUTE_SECTION_LEDGER).map(async ([routeName, entry]) => [
        routeName,
        {
          file: entry.file,
          source: await readFile(path.join(output, entry.file), "utf8"),
        },
      ]),
    ),
  );
}

test("one exact map accounts for all 17 public routes and every remaining unit contract", () => {
  assert.deepEqual(Object.keys(PUBLIC_ROUTE_SECTION_LEDGER), CANONICAL_ROUTES);
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(PUBLIC_ROUTE_SECTION_LEDGER).map(([routeName, entry]) => [
        routeName,
        entry.file,
      ]),
    ),
    Object.fromEntries(CANONICAL_ROUTES.map((routeName) => [
      routeName,
      routeToFile(routeName),
    ])),
  );
  assert.deepEqual(REMAINING_LEDGER_ROUTES, [
    "/",
    "/abracadabra/",
    "/abracadabra/how/",
    "/abracadabra/app/",
    "/hive/",
    "/faq/",
    "/legal/",
    "/legal/privacy/",
    "/legal/website-terms/",
  ]);
  assert.deepEqual(
    Object.values(PUBLIC_ROUTE_SECTION_LEDGER).reduce((counts, entry) => {
      counts[entry.source] = (counts[entry.source] ?? 0) + 1;
      return counts;
    }, {}),
    {
      "paid-route-contracts": 4,
      "remaining-section-ledger": 9,
      "trust-intake-contracts": 4,
    },
  );

  let heldUnits = 0;
  let hostedUnits = 0;
  for (const routeName of REMAINING_LEDGER_ROUTES) {
    const entry = PUBLIC_ROUTE_SECTION_LEDGER[routeName];
    for (const variant of ["held", "hosted"]) {
      const ids = new Set();
      for (const contract of entry[variant]) {
        assert.match(contract.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
        assert.match(contract.job, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
        assert.ok(contract.evidence.length > 0);
        assert.ok(contract.fallback.length > 0);
        assert.ok(contract.match && typeof contract.match === "object");
        assert.equal(ids.has(contract.id), false, `${routeName} duplicates ${contract.id}`);
        ids.add(contract.id);
      }
    }
    heldUnits += entry.held.length;
    hostedUnits += entry.hosted.length;
  }
  assert.equal(heldUnits, 116);
  assert.equal(hostedUnits, 152);
});

test("the checked-in held pages satisfy all 116 ordered customer-unit contracts", async () => {
  const sources = await loadCustomerSectionRouteSources(SITE_ROOT);
  assert.deepEqual(validateCustomerSectionLedger(sources, { variant: "held" }), []);
});

test("the transformed hosted artifact satisfies all 152 ordered customer-unit contracts", async (t) => {
  const sources = await loadHostedRouteSources(t);
  assert.deepEqual(validateCustomerSectionLedger(sources, { variant: "hosted" }), []);
  assert.notDeepEqual(
    validateCustomerSectionLedger(sources, { variant: "held" }),
    [],
    "hosted legal and Abracadabra truth must not be accepted as the held variant",
  );
});

test("the ledger rejects a missing, duplicate, misordered, or uncontracted section", async () => {
  const sources = await loadCustomerSectionRouteSources(SITE_ROOT);
  const faq = sources.get("/faq/").source;
  const paths = detailsBlock(faq, "paths");
  const customScope = detailsBlock(faq, "custom-scope");

  const missing = validateCustomerSectionLedger(
    mutateRoute(sources, "/faq/", (source) => source.replace(paths, "")),
  );
  assertFailure(missing, "faq-paths selector");

  const duplicate = validateCustomerSectionLedger(
    mutateRoute(sources, "/faq/", (source) => source.replace(paths, `${paths}${paths}`)),
  );
  assertFailure(duplicate, "faq-paths selector");

  const misordered = validateCustomerSectionLedger(
    mutateRoute(sources, "/faq/", (source) => swap(source, paths, customScope)),
  );
  assertFailure(misordered, "missing, duplicated, misordered, or uncontracted");

  const uncontracted = validateCustomerSectionLedger(
    mutateRoute(sources, "/", (source) =>
      source.replace(
        "</main>",
        "<section><h2>Uncontracted customer section</h2></section></main>",
      )),
  );
  assertFailure(uncontracted, "missing, duplicated, misordered, or uncontracted");
});

test("the ledger rejects a second primary, lost evidence, and lost JavaScript-off fallback", async () => {
  const sources = await loadCustomerSectionRouteSources(SITE_ROOT);

  const duplicatePrimary = validateCustomerSectionLedger(
    mutateRoute(sources, "/", (source) =>
      source.replace(
        'class="button" data-home-door="abracadabra"',
        'class="button button-primary" data-home-door="abracadabra"',
      )),
  );
  assertFailure(duplicatePrimary, "exposes 2 primary actions; maximum is 1");

  const lostEvidence = validateCustomerSectionLedger(
    mutateRoute(sources, "/legal/privacy/", (source) =>
      source.replace(' data-legal-clause="operator"', "")),
  );
  assertFailure(lostEvidence, "privacy-operator lacks its exact evidence node");

  const lostFallback = validateCustomerSectionLedger(
    mutateRoute(sources, "/hive/", (source) =>
      source.replace(/<noscript\b[\s\S]*?<\/noscript>/u, "")),
  );
  assertFailure(lostFallback, "lacks its JavaScript-off alternative");
});
