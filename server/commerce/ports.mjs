import { invariant } from "../domain/errors.mjs";

const REQUIRED = Object.freeze({
  catalog: ["current"],
  projects: ["resolveForCommerce"],
  repository: [
    "claimCommand",
    "releaseCommand",
    "createQuote",
    "getQuote",
    "commit",
    "listAudit",
    "listOutbox"
  ],
  domainQuotes: ["resolveForCommerce"],
  stripe: ["readiness", "createCheckout"],
  clock: ["now"],
  ids: ["next"]
});

export function validateCommercePorts(ports) {
  invariant(ports && typeof ports === "object", "invalid_ports", "commerce ports are required", { status: 500 });
  for (const [name, methods] of Object.entries(REQUIRED)) {
    invariant(ports[name], "invalid_ports", `missing commerce port ${name}`, { status: 500 });
    for (const method of methods) {
      invariant(
        typeof ports[name][method] === "function",
        "invalid_ports",
        `missing commerce port method ${name}.${method}`,
        { status: 500 }
      );
    }
  }
  return ports;
}
