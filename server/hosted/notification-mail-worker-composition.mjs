import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";

import {
  REVIEWED_NOTIFICATION_TEMPLATE_REGISTRY_SHA256,
  REVIEWED_NOTIFICATION_TEMPLATE_VERSIONS
} from "../../ops/notification-mail-private-renderer.mjs";
import { invariant } from "./errors.mjs";
import { createMailLifecycle } from "./mail-lifecycle.mjs";
import {
  createPostgresMailLifecycleRepository
} from "./mail-lifecycle-postgres.mjs";
import {
  createPostgresNotificationMailDispatchSource
} from "./notification-mail-dispatch-postgres.mjs";
import {
  createNotificationMailDispatcher
} from "./notification-mail-dispatcher.mjs";
import {
  createNotificationMailWorker,
  notificationMailWorkerOptionsFromEnvironment
} from "./notification-mail-worker.mjs";
import { createResendMailTransport } from "./resend-mail-transport.mjs";
import { WORKER_PURPOSES } from "./worker-config.mjs";

const PURPOSE = "notification-mail";
const MODULE_PATH_ENVIRONMENT =
  "SITESOURCERY_NOTIFICATION_MAIL_RENDERER_MODULE";
const MODULE_SHA_ENVIRONMENT =
  "SITESOURCERY_NOTIFICATION_MAIL_RENDERER_SHA256";
const RENDERER_MODE_ENVIRONMENT =
  "SITESOURCERY_NOTIFICATION_MAIL_PRIVATE_RENDERER_MODE";
const REGISTRY_SHA_ENVIRONMENT =
  "SITESOURCERY_NOTIFICATION_MAIL_TEMPLATE_REGISTRY_SHA256";
const OPERATOR_RECIPIENT_ENVIRONMENT =
  "SITESOURCERY_NOTIFICATION_MAIL_OPERATOR_RECIPIENT";
const RENDERER_ROOT = "/etc/sitesourcery/mail";
const MAXIMUM_RENDERER_BYTES = 256 * 1024;
const SHA256 = /^[0-9a-f]{64}$/u;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function selectedPurposes(purposes) {
  invariant(
    Array.isArray(purposes) &&
      purposes.length >= 1 &&
      purposes.length <= WORKER_PURPOSES.length &&
      purposes.every((purpose) => WORKER_PURPOSES.includes(purpose)) &&
      new Set(purposes).size === purposes.length &&
      JSON.stringify(purposes) === JSON.stringify(
        WORKER_PURPOSES.filter((purpose) => purposes.includes(purpose))
      ),
    "WORKER_CONFIGURATION_INVALID",
    "Notification mail worker purposes are invalid.",
    { status: 500 }
  );
  return purposes.includes(PURPOSE);
}

function environmentValue(environment, name) {
  const selected = environment?.[name];
  return typeof selected === "string" && selected.length > 0
    ? selected
    : null;
}

function productionConfiguration(environment) {
  const modulePath = environmentValue(environment, MODULE_PATH_ENVIRONMENT);
  const expectedSha256 = environmentValue(environment, MODULE_SHA_ENVIRONMENT);
  const rendererMode = environmentValue(
    environment,
    RENDERER_MODE_ENVIRONMENT
  );
  const templateRegistrySha256 = environmentValue(
    environment,
    REGISTRY_SHA_ENVIRONMENT
  );
  const operatorRecipient = environmentValue(
    environment,
    OPERATOR_RECIPIENT_ENVIRONMENT
  );
  const apiKey = environmentValue(environment, "SITESOURCERY_RESEND_API_KEY");
  const domainId = environmentValue(
    environment,
    "SITESOURCERY_RESEND_DOMAIN_ID"
  );
  invariant(
    modulePath !== null &&
      path.isAbsolute(modulePath) &&
      path.normalize(modulePath) === modulePath &&
      modulePath.startsWith(`${RENDERER_ROOT}${path.sep}`) &&
      !path.relative(RENDERER_ROOT, modulePath).startsWith("..") &&
      /^\/[A-Za-z0-9._/-]{20,240}\.mjs$/u.test(modulePath) &&
      SHA256.test(expectedSha256 ?? "") &&
      rendererMode === "reviewed" &&
      templateRegistrySha256 ===
        REVIEWED_NOTIFICATION_TEMPLATE_REGISTRY_SHA256 &&
      typeof operatorRecipient === "string" &&
      operatorRecipient === operatorRecipient.trim().toLowerCase() &&
      operatorRecipient.length <= 254 &&
      /^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(operatorRecipient) &&
      typeof apiKey === "string" &&
      apiKey.startsWith("re_") &&
      apiKey.length >= 10 && apiKey.length <= 512 &&
      !/\s/u.test(apiKey) &&
      UUID.test(domainId ?? ""),
    "NOTIFICATION_MAIL_WORKER_CONFIGURATION_INVALID",
    "Approved notification mail requires exact renderer and Resend configuration.",
    { status: 500 }
  );
  return Object.freeze({
    modulePath,
    expectedSha256,
    rendererConfiguration: Object.freeze({
      mode: rendererMode,
      operatorRecipient,
      templateRegistrySha256
    })
  });
}

async function defaultRendererLoader({
  modulePath,
  expectedSha256,
  rendererConfiguration,
  authority
}) {
  let handle;
  try {
    handle = await open(
      modulePath,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW
    );
    const before = await handle.stat();
    invariant(
      before.isFile() &&
        before.size >= 1 && before.size <= MAXIMUM_RENDERER_BYTES,
      "NOTIFICATION_MAIL_WORKER_CONFIGURATION_INVALID",
      "The private renderer module is not one bounded regular file.",
      { status: 500 }
    );
    const bytes = await handle.readFile();
    const after = await handle.stat();
    invariant(
      before.dev === after.dev && before.ino === after.ino &&
        before.size === after.size && before.mtimeMs === after.mtimeMs &&
        bytes.byteLength === before.size &&
        createHash("sha256").update(bytes).digest("hex") === expectedSha256,
      "NOTIFICATION_MAIL_WORKER_CONFIGURATION_INVALID",
      "The private renderer module does not match its reviewed digest.",
      { status: 500 }
    );
    const loaded = await import(
      `data:text/javascript;base64,${bytes.toString("base64")}`
    );
    invariant(
      typeof loaded?.createNotificationMailPrivateRenderer === "function",
      "NOTIFICATION_MAIL_WORKER_CONFIGURATION_INVALID",
      "The private renderer module lacks its exact factory.",
      { status: 500 }
    );
    return loaded.createNotificationMailPrivateRenderer({
      authority,
      configuration: rendererConfiguration
    });
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

function exactLoop(environment, configured, selected) {
  const fields = Object.freeze({
    intervalMs: "SITESOURCERY_NOTIFICATION_MAIL_WORKER_INTERVAL_MS",
    errorBackoffMs:
      "SITESOURCERY_NOTIFICATION_MAIL_WORKER_ERROR_BACKOFF_MS",
    maximumBackoffMs:
      "SITESOURCERY_NOTIFICATION_MAIL_WORKER_MAXIMUM_BACKOFF_MS"
  });
  invariant(
    configured && typeof configured === "object" &&
      Object.keys(configured).length === 3 &&
      Object.keys(fields).every((field) =>
        Number.isSafeInteger(configured[field]) &&
        (
          environment?.[fields[field]] === undefined ||
          environment[fields[field]] === "" ||
          configured[field] === selected[field]
        )
      ),
    "WORKER_CONFIGURATION_INVALID",
    "Notification mail loop conflicts with process configuration.",
    { status: 500 }
  );
  return Object.freeze({
    intervalMs: configured.intervalMs,
    errorBackoffMs: configured.errorBackoffMs,
    maximumBackoffMs: configured.maximumBackoffMs
  });
}

function heldComposition(options, loop, log) {
  const service = Object.freeze({
    async processBatch() {
      throw new Error("Held notification mail cannot process a batch.");
    }
  });
  return Object.freeze({
    worker: createNotificationMailWorker({
      service,
      enabled: false,
      batchLimit: options.batchLimit,
      ...loop,
      log
    }),
    async readiness() {
      return Object.freeze({
        schema: "sitesourcery.notification-mail-worker-readiness/v1",
        ready: false,
        verified: false,
        purpose: PURPOSE,
        mode: "held",
        code: "NOTIFICATION_MAIL_WORKER_HELD",
        providerEffects: false
      });
    }
  });
}

export function createNotificationMailWorkerFactories({
  authority,
  purposes,
  environment = process.env,
  log = () => {},
  rendererLoader = defaultRendererLoader,
  providerFactory = createResendMailTransport,
  sourceFactory = createPostgresNotificationMailDispatchSource,
  lifecycleRepositoryFactory = createPostgresMailLifecycleRepository,
  clock = { now: () => new Date().toISOString() }
} = {}) {
  const selected = selectedPurposes(purposes);
  invariant(
    authority?.kind === "canonical-postgres" &&
      typeof authority.readiness === "function" &&
      typeof log === "function" &&
      typeof rendererLoader === "function" &&
      typeof providerFactory === "function" &&
      typeof sourceFactory === "function" &&
      typeof lifecycleRepositoryFactory === "function",
    "WORKER_CONFIGURATION_INVALID",
    "Notification mail composition dependencies are invalid.",
    { status: 500 }
  );
  if (!selected) return Object.freeze({});
  let compositionPromise = null;

  async function factory({ loop }) {
    if (!compositionPromise) {
      compositionPromise = (async () => {
        const options = notificationMailWorkerOptionsFromEnvironment(
          environment
        );
        const selectedLoop = exactLoop(environment, loop, options);
        if (!options.enabled) {
          return heldComposition(options, selectedLoop, log);
        }
        const configuration = productionConfiguration(environment);
        const renderer = await rendererLoader({
          ...configuration,
          authority
        });
        invariant(
          renderer?.kind === "private-notification-mail-renderer" &&
            renderer.mode === "private-resolvers" &&
            renderer.providerEffects === false &&
            renderer.redactionPolicy ===
              "no-log-no-arbitrary-content-v1" &&
            renderer.templateRegistrySha256 ===
              configuration.rendererConfiguration
                .templateRegistrySha256 &&
            JSON.stringify(renderer.supportedTemplateVersions) ===
              JSON.stringify(
                REVIEWED_NOTIFICATION_TEMPLATE_VERSIONS
              ) &&
            typeof renderer.readiness === "function" &&
            typeof renderer.render === "function",
          "NOTIFICATION_MAIL_WORKER_CONFIGURATION_INVALID",
          "The reviewed private renderer is invalid.",
          { status: 500 }
        );
        const provider = providerFactory({ environment, clock });
        invariant(
          provider?.kind === "notification-mail-provider" &&
            provider.mode === "production" &&
            provider.provider === "resend" &&
            provider.providerEffects === true &&
            typeof provider.readiness === "function" &&
            typeof provider.sendNotification === "function",
          "NOTIFICATION_MAIL_WORKER_CONFIGURATION_INVALID",
          "The exact Resend notification provider is invalid.",
          { status: 500 }
        );
        const lifecycle = createMailLifecycle({
          repository: lifecycleRepositoryFactory({ authority }),
          clock
        });
        const source = sourceFactory({ authority, clock });
        invariant(
          source?.providerEffects === false &&
            typeof source.listDispatchable === "function",
          "NOTIFICATION_MAIL_WORKER_CONFIGURATION_INVALID",
          "The durable notification source is invalid.",
          { status: 500 }
        );
        const dispatcher = createNotificationMailDispatcher({
          source,
          renderer,
          providerPort: provider,
          lifecycle,
          leaseMs: options.leaseMs,
          clock
        });
        const service = Object.freeze({
          async processBatch({ workerId, limit, signal }) {
            const messageIds = await source.listDispatchable({ limit });
            const result = {
              selected: 0,
              accepted: 0,
              alreadyRecorded: 0,
              busy: 0,
              expired: 0
            };
            for (const messageId of messageIds) {
              if (signal.aborted) break;
              result.selected += 1;
              const receipt = await dispatcher.dispatch({
                messageId,
                workerId
              });
              if (receipt.dispatchState === "provider_accepted") {
                result.accepted += 1;
              } else if (receipt.dispatchState === "already_recorded") {
                result.alreadyRecorded += 1;
              } else if (receipt.dispatchState === "busy") {
                result.busy += 1;
              } else if (receipt.dispatchState === "expired") {
                result.expired += 1;
              } else {
                invariant(
                  false,
                  "NOTIFICATION_MAIL_WORKER_RECEIPT_INVALID",
                  "The notification dispatcher returned an invalid state.",
                  { status: 500 }
                );
              }
            }
            return Object.freeze(result);
          }
        });
        return Object.freeze({
          worker: createNotificationMailWorker({
            service,
            enabled: true,
            batchLimit: options.batchLimit,
            ...selectedLoop,
            log
          }),
          async readiness() {
            const statuses = await Promise.all([
              source.readiness(),
              renderer.readiness(),
              provider.readiness(),
              lifecycle.readiness()
            ]);
            const ready = statuses.every(
              (status) => status?.ready === true && status?.verified === true
            );
            return Object.freeze({
              schema:
                "sitesourcery.notification-mail-worker-readiness/v1",
              ready,
              verified: ready,
              purpose: PURPOSE,
              mode: "approved_live",
              code: ready
                ? null
                : statuses.find(
                    (status) =>
                      status?.ready !== true || status?.verified !== true
                  )?.code ?? "NOTIFICATION_MAIL_WORKER_NOT_READY",
              providerEffects: ready
            });
          }
        });
      })();
    }
    return compositionPromise;
  }

  return Object.freeze({ [PURPOSE]: factory });
}
