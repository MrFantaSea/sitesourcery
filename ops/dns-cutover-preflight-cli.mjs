import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

import { canonicalJson } from "./immutable-evidence.mjs";
import {
  DNS_PREFLIGHT_RECEIPT_SCHEMA,
  runDnsCutoverPreflight
} from "./dns-cutover-preflight.mjs";

const FAILURE_SCHEMA =
  "sitesourcery.dns-cutover-preflight-failure/v1";
const OUTPUT_LIMIT = 128 * 1024;
const SAFE_ERROR_CODE = /^DNS_PREFLIGHT_[A-Z0-9_]+$/u;
const DIG_ENV = Object.freeze({
  LANG: "C",
  LC_ALL: "C",
  PATH: "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin"
});

export function createDigCommandRunner({ spawnCommand = spawn } = {}) {
  return Object.freeze({
    run({ command, args, timeoutMs }) {
      if (
        command !== "dig" ||
        !Array.isArray(args) ||
        args.some((value) => typeof value !== "string") ||
        !Number.isInteger(timeoutMs) ||
        timeoutMs < 1 ||
        timeoutMs > 5000
      ) {
        return Promise.reject(new Error("command rejected"));
      }
      return new Promise((resolve, reject) => {
        let stdout = "";
        let settled = false;
        const child = spawnCommand(command, args, {
          env: DIG_ENV,
          shell: false,
          stdio: ["ignore", "pipe", "ignore"]
        });
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          finish(reject, new Error("command timeout"));
        }, timeoutMs);
        timer.unref?.();

        function finish(callback, value) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          callback(value);
        }

        child.once("error", (error) => finish(reject, error));
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
          stdout += chunk;
          if (Buffer.byteLength(stdout, "utf8") > OUTPUT_LIMIT) {
            child.kill("SIGKILL");
            finish(reject, new Error("command output rejected"));
          }
        });
        child.once("close", (exitCode) => {
          finish(resolve, {
            exitCode: Number.isInteger(exitCode) ? exitCode : 1,
            stdout
          });
        });
      });
    }
  });
}

export async function main({
  argv = [],
  now = new Date(),
  commandRunner = createDigCommandRunner(),
  write = (value) => process.stdout.write(value)
} = {}) {
  if (!Array.isArray(argv) || argv.length !== 0) {
    const error = new Error("arguments rejected");
    error.code = "DNS_PREFLIGHT_ARGUMENTS_REJECTED";
    throw error;
  }
  const receipt = await runDnsCutoverPreflight({ commandRunner, now });
  write(`${canonicalJson(receipt)}\n`);
  return receipt;
}

function failureReceipt(error) {
  const candidate = error?.code;
  return Object.freeze({
    schema: FAILURE_SCHEMA,
    ok: false,
    code: typeof candidate === "string" && SAFE_ERROR_CODE.test(candidate)
      ? candidate
      : "DNS_PREFLIGHT_FAILED",
    expectedReceiptSchema: DNS_PREFLIGHT_RECEIPT_SCHEMA,
    mutationAuthorized: false
  });
}

const invokedDirectly = process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main({ argv: process.argv.slice(2) }).catch((error) => {
    process.stderr.write(`${canonicalJson(failureReceipt(error))}\n`);
    process.exitCode = 1;
  });
}
