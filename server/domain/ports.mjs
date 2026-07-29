import { invariant } from "./errors.mjs";

const REQUIRED = Object.freeze({
  repository: [
    "claimCommand",
    "finishCommand",
    "createOrder",
    "getOrder",
    "commit",
    "listAudit",
    "listOutbox"
  ],
  registrar: [
    "ensureContacts",
    "previewRegistration",
    "confirmRegistration",
    "getOperation",
    "getDomain",
    "assessTransferOut",
    "setTransferLock",
    "getAuthCode"
  ],
  payments: ["authorize", "voidAuthorization", "capture", "refund"],
  secrets: ["issueOneTime"],
  clock: ["now"],
  ids: ["next"]
});

export function validatePorts(ports) {
  invariant(ports && typeof ports === "object", "invalid_ports", "ports are required", {
    status: 500
  });
  for (const [name, methods] of Object.entries(REQUIRED)) {
    invariant(ports[name], "invalid_ports", `missing port ${name}`, { status: 500 });
    for (const method of methods) {
      invariant(
        typeof ports[name][method] === "function",
        "invalid_ports",
        `missing port method ${name}.${method}`,
        { status: 500 }
      );
    }
  }
  return ports;
}
