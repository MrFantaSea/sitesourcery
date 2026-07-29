#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  PUBLIC_ROUTE_SECTION_LEDGER,
  REMAINING_LEDGER_ROUTES,
  validateCustomerSectionLedger,
} from "./customer-section-ledger.mjs";

export async function loadCustomerSectionRouteSources(root = process.cwd()) {
  const absoluteRoot = path.resolve(root);
  return new Map(
    await Promise.all(
      Object.entries(PUBLIC_ROUTE_SECTION_LEDGER).map(async ([routeName, entry]) => [
        routeName,
        {
          file: entry.file,
          source: await readFile(path.join(absoluteRoot, entry.file), "utf8"),
        },
      ]),
    ),
  );
}

export async function checkCustomerSectionLedger({
  root = process.cwd(),
  variant = "held",
} = {}) {
  const sources = await loadCustomerSectionRouteSources(root);
  const failures = validateCustomerSectionLedger(sources, { variant });
  if (failures.length > 0) {
    throw new Error(
      `Customer section ledger failed (${variant}):\n- ${failures.join("\n- ")}`,
    );
  }
  return {
    routes: REMAINING_LEDGER_ROUTES.length,
    units: REMAINING_LEDGER_ROUTES.reduce(
      (count, routeName) =>
        count + PUBLIC_ROUTE_SECTION_LEDGER[routeName][variant].length,
      0,
    ),
    variant,
  };
}

const isCli = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isCli) {
  checkCustomerSectionLedger()
    .then(({ routes, units, variant }) => {
      console.log(
        `Customer section ledger passed: ${routes} remaining routes, `
        + `${units} exact ${variant} customer units, 17 public routes accounted for.`,
      );
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
