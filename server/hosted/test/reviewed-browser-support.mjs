import { spawn, spawnSync } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import os from "node:os";
import path from "node:path";

const EXPECTED_BROWSER =
  "Google Chrome for Testing 149.0.7827.55";
const DEFAULT_BROWSER_CANDIDATES = Object.freeze([
  process.env.SITESOURCERY_CHROMIUM,
  "/private/tmp/sitesourcery-chrome-149.0.7827.55-mac-arm64/chrome-headless-shell-mac-arm64/chrome-headless-shell",
  "/home/simtech/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell",
  "/home/simtech/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell"
].filter(Boolean));

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function reviewedBrowserPath(candidates) {
  const failures = [];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      const result = spawnSync(candidate, ["--version"], {
        encoding: "utf8",
        timeout: 5000
      });
      const observed = String(result.stdout ?? "").trim();
      if (
        result.status === 0 &&
        observed === EXPECTED_BROWSER
      ) {
        return candidate;
      }
      failures.push(
        `${candidate}: ${observed || "no version"}`
      );
    } catch {
      failures.push(`${candidate}: unavailable`);
    }
  }
  throw new Error(
    `No exact reviewed browser was found. Expected ${EXPECTED_BROWSER}. ` +
      failures.join("; ")
  );
}

async function freePort() {
  const server = createNetServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port =
    address && typeof address === "object"
      ? address.port
      : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.sequence = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, {
        once: true
      });
      this.socket.addEventListener("error", reject, {
        once: true
      });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) {
          pending.reject(
            new Error(
              `${pending.method}: ${message.error.message}`
            )
          );
        } else {
          pending.resolve(message.result);
        }
        return;
      }
      for (
        const listener of
        this.listeners.get(message.method) ?? []
      ) {
        listener(message.params ?? {});
      }
    });
  }

  async send(method, params = {}) {
    await this.ready;
    const id = ++this.sequence;
    const result = new Promise((resolve, reject) => {
      this.pending.set(id, {
        method,
        reject,
        resolve
      });
    });
    this.socket.send(JSON.stringify({ id, method, params }));
    return result;
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  close() {
    this.socket.close();
  }
}

async function pageSocket(port, processState) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (processState.exited) {
      throw new Error(
        "Reviewed browser exited before CDP opened: " +
          processState.stderr
      );
    }
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/json/list`
      );
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find(
          (target) =>
            target.type === "page" &&
            target.webSocketDebuggerUrl
        );
        if (page) return page.webSocketDebuggerUrl;
      }
    } catch {
      // The reviewed browser is still starting.
    }
    await delay(100);
  }
  throw new Error(
    `Timed out opening reviewed browser: ${processState.stderr}`
  );
}

export async function openReviewedBrowser({
  origin,
  candidates = DEFAULT_BROWSER_CANDIDATES,
  viewport = {
    width: 390,
    height: 844,
    mobile: true
  }
} = {}) {
  if (typeof origin !== "string" || !origin) {
    throw new TypeError("A local browser origin is required.");
  }
  const executable = await reviewedBrowserPath(candidates);
  const profile = await mkdtemp(
    path.join(os.tmpdir(), "sitesourcery-real-account-browser-")
  );
  const port = await freePort();
  const processState = {
    exited: false,
    stderr: ""
  };
  const child = spawn(executable, [
    "--headless",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-sync",
    "--metrics-recording-only",
    "--no-default-browser-check",
    "--no-first-run",
    `--remote-debugging-port=${port}`,
    `--unsafely-treat-insecure-origin-as-secure=${origin}`,
    `--user-data-dir=${profile}`,
    "about:blank"
  ], {
    stdio: ["ignore", "ignore", "pipe"]
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    processState.stderr = (
      processState.stderr + chunk
    ).slice(-32768);
  });
  child.once("exit", () => {
    processState.exited = true;
  });

  let cdp = null;
  let closed = false;
  const browserErrors = [];
  async function close() {
    if (closed) return;
    closed = true;
    if (cdp) cdp.close();
    if (!processState.exited) child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      delay(2000)
    ]);
    if (!processState.exited) child.kill("SIGKILL");
    await rm(profile, {
      recursive: true,
      force: true
    });
  }

  try {
    cdp = new Cdp(await pageSocket(port, processState));
    cdp.on(
      "Runtime.exceptionThrown",
      ({ exceptionDetails }) => {
        browserErrors.push(
          exceptionDetails?.exception?.description ||
            exceptionDetails?.text ||
            "Unknown browser exception"
        );
      }
    );
    cdp.on("Log.entryAdded", ({ entry }) => {
      if (entry?.level === "error") {
        browserErrors.push(
          entry.text || "Unknown browser log error"
        );
      }
    });
    await Promise.all([
      cdp.send("Page.enable"),
      cdp.send("Runtime.enable"),
      cdp.send("Log.enable"),
      cdp.send("Network.enable")
    ]);
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.mobile,
      screenWidth: viewport.width,
      screenHeight: viewport.height
    });
    await cdp.send("Emulation.setTouchEmulationEnabled", {
      enabled: viewport.mobile,
      maxTouchPoints: viewport.mobile ? 5 : 1
    });

    async function evaluate(
      expression,
      awaitPromise = false
    ) {
      const result = await cdp.send("Runtime.evaluate", {
        expression,
        awaitPromise,
        returnByValue: true,
        userGesture: true
      });
      if (result.exceptionDetails) {
        throw new Error(
          result.exceptionDetails.exception?.description ||
            result.exceptionDetails.text ||
            "Browser evaluation failed."
        );
      }
      return result.result?.value;
    }

    async function waitFor(expression, timeoutMs = 10000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        try {
          if (
            await evaluate(`Boolean(${expression})`)
          ) {
            return;
          }
        } catch {
          // Navigation can briefly destroy the execution context.
        }
        await delay(50);
      }
      throw new Error(
        `Timed out waiting for ${expression}`
      );
    }

    async function navigate(url) {
      await cdp.send("Page.navigate", { url });
      await waitFor(
        `document.readyState === "complete" && ` +
          `location.href === ${JSON.stringify(url)}`
      );
    }

    return Object.freeze({
      browserErrors,
      cdp,
      close,
      evaluate,
      navigate,
      waitFor
    });
  } catch (error) {
    await close();
    throw error;
  }
}
