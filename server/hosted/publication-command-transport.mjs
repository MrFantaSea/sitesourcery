import { createHash, timingSafeEqual } from "node:crypto";
import { lstat, chmod, unlink } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { createConnection } from "node:net";
import path from "node:path";

import { HostedError, invariant } from "./errors.mjs";
import { canonicalJson } from "./security.mjs";

export const PUBLICATION_COMMAND_SCHEMA =
  "sitesourcery.internal-publication-command/v1";
export const PUBLICATION_RESULT_SCHEMA =
  "sitesourcery.internal-publication-result/v1";
export const PUBLICATION_READINESS_SCHEMA =
  "sitesourcery.internal-publication-readiness/v1";
export const PUBLICATION_SERVER_STATE_SCHEMA =
  "sitesourcery.internal-publication-server-state/v1";
export const DEFAULT_PUBLICATION_COMMAND_SOCKET =
  "/run/sitesourcery/publication-command-v1.sock";

const OPERATIONS = new Set(["request", "rollback", "unpublish"]);
const SHA256 = /^[a-f0-9]{64}$/u;
const BASE64URL = /^[A-Za-z0-9_-]{43}$/u;
const MINIMUM_BODY_BYTES = 1024 * 1024;
const MAXIMUM_BODY_BYTES = 16 * 1024 * 1024;
const MAXIMUM_HTML_BYTES = 10 * 1024 * 1024;
const MINIMUM_DEADLINE_MS = 1_000;
const MAXIMUM_DEADLINE_MS = 15_000;

function exactObject(value, keys, field) {
  invariant(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...keys].sort()),
    "PUBLICATION_COMMAND_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function strictClone(value, field = "Publication command value") {
  if (
    value === null || typeof value === "string" ||
    typeof value === "boolean"
  ) return value;
  if (typeof value === "number") {
    invariant(
      Number.isFinite(value),
      "PUBLICATION_COMMAND_INVALID",
      `${field} contains an invalid number.`,
      { status: 400 }
    );
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => strictClone(item, `${field}[${index}]`));
  }
  invariant(
    value && Object.getPrototypeOf(value) === Object.prototype,
    "PUBLICATION_COMMAND_INVALID",
    `${field} contains an unsupported value.`,
    { status: 400 }
  );
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      strictClone(item, `${field}.${key}`)
    ])
  );
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalToken(value) {
  invariant(
    typeof value === "string" && BASE64URL.test(value),
    "PUBLICATION_COMMAND_CONFIGURATION_INVALID",
    "The publication command token must be canonical base64url.",
    { status: 500 }
  );
  const bytes = Buffer.from(value, "base64url");
  invariant(
    bytes.byteLength === 32 && bytes.toString("base64url") === value,
    "PUBLICATION_COMMAND_CONFIGURATION_INVALID",
    "The publication command token must decode to exactly 32 bytes.",
    { status: 500 }
  );
  return value;
}

export function createPublicationCommandConfiguration({
  socketPath = DEFAULT_PUBLICATION_COMMAND_SOCKET,
  token,
  maximumBodyBytes = MAXIMUM_BODY_BYTES,
  deadlineMs = MAXIMUM_DEADLINE_MS,
  allowedSocketRoot = "/run/sitesourcery"
} = {}) {
  const normalizedRoot = path.resolve(allowedSocketRoot);
  const normalizedSocket = path.resolve(socketPath);
  invariant(
    path.isAbsolute(socketPath) && normalizedSocket === socketPath &&
      normalizedSocket.startsWith(`${normalizedRoot}${path.sep}`) &&
      normalizedSocket.endsWith(".sock"),
    "PUBLICATION_COMMAND_CONFIGURATION_INVALID",
    "The publication command socket path is invalid.",
    { status: 500 }
  );
  invariant(
    Number.isSafeInteger(maximumBodyBytes) &&
      maximumBodyBytes >= MINIMUM_BODY_BYTES &&
      maximumBodyBytes <= MAXIMUM_BODY_BYTES,
    "PUBLICATION_COMMAND_CONFIGURATION_INVALID",
    "The publication command body limit is invalid.",
    { status: 500 }
  );
  invariant(
    Number.isSafeInteger(deadlineMs) &&
      deadlineMs >= MINIMUM_DEADLINE_MS &&
      deadlineMs <= MAXIMUM_DEADLINE_MS,
    "PUBLICATION_COMMAND_CONFIGURATION_INVALID",
    "The publication command deadline is invalid.",
    { status: 500 }
  );
  return Object.freeze({
    socketPath: normalizedSocket,
    token: canonicalToken(token),
    maximumBodyBytes,
    deadlineMs,
    allowedSocketRoot: normalizedRoot
  });
}

export function publicationCommandConfigurationFromEnvironment(
  environment = process.env
) {
  return createPublicationCommandConfiguration({
    socketPath:
      environment.SITESOURCERY_PUBLICATION_COMMAND_SOCKET ??
      DEFAULT_PUBLICATION_COMMAND_SOCKET,
    token: environment.SITESOURCERY_PUBLICATION_COMMAND_TOKEN,
    maximumBodyBytes: Number(
      environment.SITESOURCERY_PUBLICATION_COMMAND_MAX_BODY_BYTES ??
        MAXIMUM_BODY_BYTES
    ),
    deadlineMs: Number(
      environment.SITESOURCERY_PUBLICATION_COMMAND_DEADLINE_MS ??
        MAXIMUM_DEADLINE_MS
    )
  });
}

function encodedInput(operation, input) {
  if (operation === "unpublish") {
    return strictClone(
      exactObject(input, ["hostname", "projectId"], "Unpublish command")
    );
  }
  invariant(
    input && Object.getPrototypeOf(input) === Object.prototype,
    "PUBLICATION_COMMAND_INVALID",
    "Publication proof is invalid.",
    { status: 400 }
  );
  const artifact = input.artifact;
  invariant(
    artifact && Object.getPrototypeOf(artifact) === Object.prototype &&
      (Buffer.isBuffer(artifact.htmlBytes) ||
        artifact.htmlBytes instanceof Uint8Array),
    "PUBLICATION_COMMAND_INVALID",
    "Publication artifact bytes are invalid.",
    { status: 400 }
  );
  const bytes = Buffer.from(
    artifact.htmlBytes.buffer,
    artifact.htmlBytes.byteOffset,
    artifact.htmlBytes.byteLength
  );
  invariant(
    bytes.byteLength >= 1 && bytes.byteLength <= MAXIMUM_HTML_BYTES &&
      SHA256.test(artifact.sha256) && sha256(bytes) === artifact.sha256,
    "PUBLICATION_COMMAND_INVALID",
    "Publication artifact integrity is invalid.",
    { status: 400 }
  );
  const { artifact: ignoredArtifact, ...rest } = input;
  const copied = strictClone(rest);
  return {
    ...copied,
    artifact: {
      compilerSchema: strictClone(artifact.compilerSchema),
      compilerRevision: strictClone(artifact.compilerRevision),
      sha256: artifact.sha256,
      htmlByteLength: bytes.byteLength,
      htmlBase64: bytes.toString("base64")
    }
  };
}

function decodedInput(operation, input) {
  if (operation === "unpublish") {
    return strictClone(
      exactObject(input, ["hostname", "projectId"], "Unpublish command")
    );
  }
  invariant(
    input && Object.getPrototypeOf(input) === Object.prototype,
    "PUBLICATION_COMMAND_INVALID",
    "Publication proof is invalid.",
    { status: 400 }
  );
  const artifact = exactObject(
    input.artifact,
    [
      "compilerRevision",
      "compilerSchema",
      "htmlBase64",
      "htmlByteLength",
      "sha256"
    ],
    "Publication artifact"
  );
  invariant(
    typeof artifact.htmlBase64 === "string" &&
      artifact.htmlBase64.length > 0 &&
      Number.isSafeInteger(artifact.htmlByteLength) &&
      artifact.htmlByteLength >= 1 &&
      artifact.htmlByteLength <= MAXIMUM_HTML_BYTES &&
      SHA256.test(artifact.sha256),
    "PUBLICATION_COMMAND_INVALID",
    "Publication artifact framing is invalid.",
    { status: 400 }
  );
  const bytes = Buffer.from(artifact.htmlBase64, "base64");
  invariant(
    bytes.toString("base64") === artifact.htmlBase64 &&
      bytes.byteLength === artifact.htmlByteLength &&
      sha256(bytes) === artifact.sha256,
    "PUBLICATION_COMMAND_INVALID",
    "Publication artifact framing failed integrity verification.",
    { status: 400 }
  );
  const { artifact: ignoredArtifact, ...rest } = input;
  const copied = strictClone(rest);
  return {
    ...copied,
    artifact: {
      compilerSchema: strictClone(artifact.compilerSchema),
      compilerRevision: strictClone(artifact.compilerRevision),
      sha256: artifact.sha256,
      htmlBytes: bytes
    }
  };
}

export function encodePublicationCommand(operation, input) {
  invariant(
    OPERATIONS.has(operation),
    "PUBLICATION_COMMAND_INVALID",
    "Publication operation is invalid.",
    { status: 400 }
  );
  return Buffer.from(`${canonicalJson({
    schema: PUBLICATION_COMMAND_SCHEMA,
    operation,
    input: encodedInput(operation, input)
  })}\n`, "utf8");
}

export function decodePublicationCommand(bytes) {
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    throw new HostedError(
      "PUBLICATION_COMMAND_INVALID",
      "Publication command JSON is invalid.",
      { status: 400 }
    );
  }
  exactObject(parsed, ["input", "operation", "schema"], "Publication command");
  invariant(
    parsed.schema === PUBLICATION_COMMAND_SCHEMA &&
      OPERATIONS.has(parsed.operation),
    "PUBLICATION_COMMAND_INVALID",
    "Publication command schema or operation is invalid.",
    { status: 400 }
  );
  return Object.freeze({
    operation: parsed.operation,
    input: decodedInput(parsed.operation, parsed.input)
  });
}

function resultEnvelope(operation, value) {
  invariant(
    OPERATIONS.has(operation),
    "PUBLICATION_COMMAND_INVALID",
    "Publication result operation is invalid.",
    { status: 400 }
  );
  return {
    schema: PUBLICATION_RESULT_SCHEMA,
    operation,
    ...value
  };
}

export function encodePublicationResult(operation, result) {
  return Buffer.from(`${canonicalJson(resultEnvelope(operation, {
    ok: true,
    result: strictClone(result, "Publication result")
  }))}\n`, "utf8");
}

function encodePublicationError(operation, error, effectCertainty) {
  const known = error instanceof HostedError;
  const status = known && Number.isSafeInteger(error.status)
    ? Math.min(599, Math.max(400, error.status))
    : 500;
  return Buffer.from(`${canonicalJson(resultEnvelope(operation, {
    ok: false,
    error: {
      code: known ? error.code : "PUBLICATION_COMMAND_FAILED",
      message: known
        ? error.message
        : "The private publication command failed.",
      status,
      effectCertainty
    }
  }))}\n`, "utf8");
}

export function decodePublicationResult(bytes, expectedOperation) {
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    throw ambiguousError("Publication command response JSON is invalid.");
  }
  let error;
  try {
    invariant(
      parsed && Object.getPrototypeOf(parsed) === Object.prototype &&
        parsed.schema === PUBLICATION_RESULT_SCHEMA &&
        (
          parsed.operation === expectedOperation ||
          (parsed.ok === false && OPERATIONS.has(parsed.operation))
        ) &&
        typeof parsed.ok === "boolean",
      "PUBLICATION_COMMAND_AMBIGUOUS",
      "Publication command response identity is invalid.",
      { status: 503 }
    );
    if (parsed.ok) {
      exactObject(
        parsed,
        ["ok", "operation", "result", "schema"],
        "Publication result"
      );
      return strictClone(parsed.result, "Publication result");
    }
    exactObject(
      parsed,
      ["error", "ok", "operation", "schema"],
      "Publication error"
    );
    error = exactObject(
      parsed.error,
      ["code", "effectCertainty", "message", "status"],
      "Publication error"
    );
    invariant(
      typeof error.code === "string" &&
        /^[A-Z][A-Z0-9_]{2,79}$/u.test(error.code) &&
        typeof error.message === "string" && error.message.length <= 300 &&
        Number.isSafeInteger(error.status) && error.status >= 400 &&
        error.status <= 599 &&
        ["none", "unknown"].includes(error.effectCertainty),
      "PUBLICATION_COMMAND_AMBIGUOUS",
      "Publication command error response is invalid.",
      { status: 503 }
    );
    invariant(
      parsed.operation === expectedOperation ||
        error.effectCertainty === "none",
      "PUBLICATION_COMMAND_AMBIGUOUS",
      "Publication command action response identity is invalid.",
      { status: 503 }
    );
  } catch (caught) {
    throw ambiguousError(
      caught?.message ?? "Publication command response is invalid."
    );
  }
  throw new HostedError(error.code, error.message, {
    status: error.status,
    details: { transport: "unix", effectCertainty: error.effectCertainty }
  });
}

function tokenMatches(supplied, configured) {
  const left = createHash("sha256").update(String(supplied ?? "")).digest();
  const right = createHash("sha256").update(configured).digest();
  return timingSafeEqual(left, right);
}

function headerCount(request, name) {
  let count = 0;
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index].toLowerCase() === name) count += 1;
  }
  return count;
}

function jsonResponse(response, status, bytes) {
  response.writeHead(status, {
    "cache-control": "private, no-store",
    "content-type": "application/json; charset=utf-8",
    "content-length": bytes.byteLength,
    connection: "close",
    "x-content-type-options": "nosniff"
  });
  response.end(bytes);
}

function fixedError(operation, code, message, status, effectCertainty = "none") {
  return encodePublicationError(
    operation,
    new HostedError(code, message, { status }),
    effectCertainty
  );
}

async function readExactBody(request, configuration) {
  const contentLength = request.headers["content-length"];
  invariant(
    typeof contentLength === "string" && /^\d+$/u.test(contentLength) &&
      request.headers["transfer-encoding"] === undefined,
    "PUBLICATION_COMMAND_INVALID",
    "Publication command requires an exact content length.",
    { status: 400 }
  );
  const expected = Number(contentLength);
  invariant(
    Number.isSafeInteger(expected) && expected >= 2 &&
      expected <= configuration.maximumBodyBytes,
    expected > configuration.maximumBodyBytes
      ? "PUBLICATION_COMMAND_TOO_LARGE"
      : "PUBLICATION_COMMAND_INVALID",
    expected > configuration.maximumBodyBytes
      ? "Publication command body is too large."
      : "Publication command body length is invalid.",
    { status: expected > configuration.maximumBodyBytes ? 413 : 400 }
  );
  const chunks = [];
  let received = 0;
  for await (const chunk of request) {
    received += chunk.byteLength;
    invariant(
      received <= expected && received <= configuration.maximumBodyBytes,
      "PUBLICATION_COMMAND_TOO_LARGE",
      "Publication command body is too large.",
      { status: 413 }
    );
    chunks.push(chunk);
  }
  invariant(
    received === expected,
    "PUBLICATION_COMMAND_INVALID",
    "Publication command body is truncated.",
    { status: 400 }
  );
  return Buffer.concat(chunks, received);
}

function deadline(work, milliseconds, timers, onTimeout) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = timers.setTimeout(() => {
      if (settled) return;
      settled = true;
      onTimeout?.();
      reject(new HostedError(
        "PUBLICATION_COMMAND_TIMEOUT",
        "Publication command exceeded its bounded deadline.",
        { status: 504 }
      ));
    }, milliseconds);
    timer.unref?.();
    Promise.resolve(work).then(
      (value) => {
        if (settled) return;
        settled = true;
        timers.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        timers.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function socketState(socketPath) {
  try {
    return await lstat(socketPath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function probeSocket(socketPath, timeoutMs = 500) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ path: socketPath });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("socket probe timed out"));
    }, timeoutMs);
    timer.unref?.();
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.end();
      resolve(true);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

export function createPublicationCommandServer({
  publicationPort,
  configuration,
  log = () => {},
  timers = globalThis
} = {}) {
  invariant(
    publicationPort &&
      typeof publicationPort.readiness === "function" &&
      typeof publicationPort.request === "function" &&
      typeof publicationPort.rollback === "function" &&
      typeof publicationPort.unpublish === "function" &&
      configuration && typeof log === "function",
    "PUBLICATION_COMMAND_CONFIGURATION_INVALID",
    "Publication command server dependencies are invalid.",
    { status: 500 }
  );
  let state = "stopped";
  let server = null;
  let active = null;
  let ownerUid = null;

  async function handle(request, response) {
    const operationHint = "request";
    if (state !== "listening") {
      jsonResponse(response, 503, fixedError(
        operationHint,
        "PUBLICATION_COMMAND_UNAVAILABLE",
        "Publication command server is unavailable.",
        503
      ));
      return;
    }
    const invalidForward = Object.keys(request.headers).some((name) =>
      name.startsWith("x-forwarded-") || name === "forwarded"
    );
    const authorization = request.headers.authorization;
    if (
      request.headers.host !== "sitesourcery-internal" || invalidForward ||
      headerCount(request, "authorization") !== 1 ||
      typeof authorization !== "string" ||
      !authorization.startsWith("Bearer ") ||
      !tokenMatches(authorization.slice(7), configuration.token)
    ) {
      jsonResponse(response, 401, fixedError(
        operationHint,
        "PUBLICATION_COMMAND_UNAUTHORIZED",
        "Publication command authentication failed.",
        401
      ));
      return;
    }
    if (request.url === "/v1/readiness") {
      if (request.method !== "GET") {
        jsonResponse(response, 405, fixedError(
          operationHint,
          "PUBLICATION_COMMAND_METHOD_NOT_ALLOWED",
          "Publication command method is not allowed.",
          405
        ));
        return;
      }
      try {
        const selected = strictClone(await publicationPort.readiness());
        const ready = selected?.ready === true;
        const bytes = Buffer.from(`${canonicalJson({
          schema: PUBLICATION_READINESS_SCHEMA,
          ready,
          held: selected?.held === true || selected?.publicationHeld === true,
          port: selected
        })}\n`, "utf8");
        jsonResponse(response, ready ? 200 : 503, bytes);
      } catch {
        jsonResponse(response, 503, fixedError(
          operationHint,
          "PUBLICATION_COMMAND_UNAVAILABLE",
          "Publication command readiness is unavailable.",
          503
        ));
      }
      return;
    }
    if (request.url !== "/v1/publication-commands") {
      jsonResponse(response, 404, fixedError(
        operationHint,
        "PUBLICATION_COMMAND_NOT_FOUND",
        "Publication command route was not found.",
        404
      ));
      return;
    }
    if (request.method !== "POST") {
      jsonResponse(response, 405, fixedError(
        operationHint,
        "PUBLICATION_COMMAND_METHOD_NOT_ALLOWED",
        "Publication command method is not allowed.",
        405
      ));
      return;
    }
    if (request.headers["content-type"] !== "application/json") {
      jsonResponse(response, 415, fixedError(
        operationHint,
        "PUBLICATION_COMMAND_CONTENT_TYPE_INVALID",
        "Publication command content type is invalid.",
        415
      ));
      return;
    }
    if (active !== null) {
      request.resume();
      jsonResponse(response, 429, fixedError(
        operationHint,
        "PUBLICATION_COMMAND_BUSY",
        "Another publication command is still in progress.",
        429
      ));
      return;
    }
    let releaseAdmission;
    const admission = new Promise((resolve) => {
      releaseAdmission = resolve;
    });
    active = admission;
    const clearAdmission = () => {
      releaseAdmission();
      if (active === admission) active = null;
    };
    let selected;
    try {
      selected = decodePublicationCommand(
        await readExactBody(request, configuration)
      );
    } catch (error) {
      clearAdmission();
      const status = error instanceof HostedError ? error.status : 400;
      jsonResponse(response, status, encodePublicationError(
        operationHint,
        error,
        "none"
      ));
      return;
    }
    const action = Promise.resolve().then(() =>
      publicationPort[selected.operation](selected.input)
    );
    action.then(
      () => undefined,
      () => undefined
    ).finally(clearAdmission);
    try {
      const result = await deadline(
        action,
        configuration.deadlineMs,
        timers
      );
      jsonResponse(
        response,
        200,
        encodePublicationResult(selected.operation, result)
      );
    } catch (error) {
      const timedOut = error?.code === "PUBLICATION_COMMAND_TIMEOUT";
      jsonResponse(response, timedOut ? 504 :
        error instanceof HostedError ? error.status : 500,
      encodePublicationError(selected.operation, error, "unknown"));
    }
  }

  async function start() {
    invariant(
      state === "stopped",
      "PUBLICATION_COMMAND_SERVER_STATE_INVALID",
      "Publication command server is not stopped.",
      { status: 500 }
    );
    state = "starting";
    try {
      const parent = await lstat(path.dirname(configuration.socketPath));
      invariant(
        parent.isDirectory() && !parent.isSymbolicLink(),
        "PUBLICATION_COMMAND_SOCKET_UNSAFE",
        "Publication command socket directory is unsafe.",
        { status: 500 }
      );
      ownerUid = typeof process.getuid === "function" ? process.getuid() : null;
      const existing = await socketState(configuration.socketPath);
      if (existing) {
        invariant(
          existing.isSocket() && !existing.isSymbolicLink() &&
            (ownerUid === null || existing.uid === ownerUid),
          "PUBLICATION_COMMAND_SOCKET_UNSAFE",
          "Publication command socket path is unsafe.",
          { status: 500 }
        );
        try {
          await probeSocket(configuration.socketPath);
          throw new HostedError(
            "PUBLICATION_COMMAND_SOCKET_IN_USE",
            "Publication command socket is already active.",
            { status: 500 }
          );
        } catch (error) {
          if (error instanceof HostedError) throw error;
          invariant(
            error?.code === "ECONNREFUSED",
            "PUBLICATION_COMMAND_SOCKET_UNSAFE",
            "Publication command socket could not be classified safely.",
            { status: 500 }
          );
          await unlink(configuration.socketPath);
        }
      }
      server = createServer((request, response) => {
        handle(request, response).catch(() => {
          if (!response.headersSent) {
            jsonResponse(response, 500, fixedError(
              "request",
              "PUBLICATION_COMMAND_FAILED",
              "The private publication command failed.",
              500
            ));
          } else {
            response.destroy();
          }
        });
      });
      server.requestTimeout = configuration.deadlineMs;
      server.headersTimeout = Math.min(configuration.deadlineMs, 10_000);
      server.keepAliveTimeout = 1_000;
      server.maxHeadersCount = 20;
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(configuration.socketPath, () => {
          server.off("error", reject);
          resolve();
        });
      });
      await chmod(configuration.socketPath, 0o600);
      const created = await lstat(configuration.socketPath);
      invariant(
        created.isSocket() && !created.isSymbolicLink() &&
          (created.mode & 0o777) === 0o600 &&
          (ownerUid === null || created.uid === ownerUid),
        "PUBLICATION_COMMAND_SOCKET_UNSAFE",
        "Publication command socket authority is invalid.",
        { status: 500 }
      );
      state = "listening";
      log(Object.freeze({
        event: "sitesourcery.publication-command.started",
        socket: "private-unix",
        credentials: "redacted"
      }));
    } catch (error) {
      state = "failed";
      if (server) await new Promise((resolve) => server.close(() => resolve()));
      server = null;
      throw error;
    }
  }

  async function stop() {
    if (state === "stopped") return false;
    state = "stopping";
    if (server) {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
    if (active) {
      await deadline(active, configuration.deadlineMs, timers);
    }
    const current = await socketState(configuration.socketPath);
    if (current) {
      invariant(
        current.isSocket() && !current.isSymbolicLink() &&
          (ownerUid === null || current.uid === ownerUid),
        "PUBLICATION_COMMAND_SOCKET_UNSAFE",
        "Publication command socket changed before cleanup.",
        { status: 500 }
      );
      await unlink(configuration.socketPath);
    }
    server = null;
    state = "stopped";
    return true;
  }

  return Object.freeze({
    kind: "private-unix-publication-command-server",
    start,
    stop,
    snapshot() {
      return Object.freeze({
        schema: PUBLICATION_SERVER_STATE_SCHEMA,
        state,
        socketPath: configuration.socketPath,
        activeCommands: active === null ? 0 : 1,
        credentials: "redacted"
      });
    }
  });
}

function ambiguousError(message) {
  return new HostedError(
    "PUBLICATION_COMMAND_AMBIGUOUS",
    message,
    { status: 503, details: { transport: "unix", effectCertainty: "unknown" } }
  );
}

function unavailableError(message) {
  return new HostedError(
    "PUBLICATION_COMMAND_UNAVAILABLE",
    message,
    { status: 503, details: { transport: "unix", effectCertainty: "none" } }
  );
}

export function createPublicationCommandClient({
  configuration,
  requestFactory = httpRequest,
  timers = globalThis
} = {}) {
  invariant(
    configuration && typeof requestFactory === "function" &&
      typeof timers?.setTimeout === "function" &&
      typeof timers?.clearTimeout === "function",
    "PUBLICATION_COMMAND_CONFIGURATION_INVALID",
    "Publication command client dependencies are invalid.",
    { status: 500 }
  );

  function send({ method, route, bytes = null, operation }) {
    return new Promise((resolve, reject) => {
      let connected = false;
      let responseStarted = false;
      let settled = false;
      let timer = null;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        if (timer !== null) timers.clearTimeout(timer);
        if (error) reject(error);
        else resolve(value);
      };
      const headers = {
        host: "sitesourcery-internal",
        authorization: `Bearer ${configuration.token}`,
        connection: "close"
      };
      if (bytes) {
        headers["content-type"] = "application/json";
        headers["content-length"] = bytes.byteLength;
      }
      const request = requestFactory({
        socketPath: configuration.socketPath,
        method,
        path: route,
        headers,
        agent: false
      }, (response) => {
        responseStarted = true;
        const chunks = [];
        let received = 0;
        response.on("data", (chunk) => {
          received += chunk.byteLength;
          if (received > configuration.maximumBodyBytes) {
            response.destroy(ambiguousError(
              "Publication command response exceeded its bounded size."
            ));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          try {
            const body = Buffer.concat(chunks, received);
            if (route === "/v1/readiness") {
              const parsed = JSON.parse(body.toString("utf8"));
              invariant(
                parsed?.schema === PUBLICATION_READINESS_SCHEMA &&
                  typeof parsed.ready === "boolean" &&
                  typeof parsed.held === "boolean",
                "PUBLICATION_COMMAND_AMBIGUOUS",
                "Publication command readiness response is invalid.",
                { status: 503, details: {
                  transport: "unix", effectCertainty: "unknown"
                } }
              );
              finish(null, Object.freeze({
                ready: response.statusCode === 200 && parsed.ready === true,
                held: parsed.held,
                kind: "private-unix-publication-command-client"
              }));
              return;
            }
            finish(null, decodePublicationResult(body, operation));
          } catch (error) {
            finish(error instanceof HostedError ? error : ambiguousError(
              "Publication command response is invalid."
            ));
          }
        });
        response.on("error", (error) => finish(ambiguousError(
          `Publication command response failed: ${error?.code ?? "unknown"}.`
        )));
      });
      request.on("socket", (socket) => {
        if (socket.connecting) socket.once("connect", () => { connected = true; });
        else connected = true;
      });
      request.once("error", (error) => {
        finish(
          connected || responseStarted
            ? ambiguousError(
                `Publication command transport failed after connect: ${error?.code ?? "unknown"}.`
              )
            : unavailableError(
                `Publication command socket is unavailable: ${error?.code ?? "unknown"}.`
              )
        );
      });
      timer = timers.setTimeout(() => {
        request.destroy();
        finish(connected
          ? ambiguousError("Publication command transport timed out.")
          : unavailableError("Publication command socket timed out before connect."));
      }, configuration.deadlineMs);
      timer.unref?.();
      if (bytes) request.end(bytes);
      else request.end();
    });
  }

  async function readiness() {
    try {
      return await send({
        method: "GET",
        route: "/v1/readiness",
        operation: "request"
      });
    } catch (error) {
      return Object.freeze({
        ready: false,
        held: true,
        kind: "private-unix-publication-command-client",
        code: error?.code ?? "PUBLICATION_COMMAND_UNAVAILABLE"
      });
    }
  }

  function command(operation, input) {
    return send({
      method: "POST",
      route: "/v1/publication-commands",
      bytes: encodePublicationCommand(operation, input),
      operation
    });
  }

  return Object.freeze({
    kind: "private-unix-publication-command-client",
    readiness,
    request: (input) => command("request", input),
    rollback: (input) => command("rollback", input),
    unpublish: (input) => command("unpublish", input)
  });
}
