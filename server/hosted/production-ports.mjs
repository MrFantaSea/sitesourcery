import { createCipheriv, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createHeldCatalogPort } from "../commerce/adapters/held.mjs";
import { invariant } from "./errors.mjs";
import {
  createDevelopmentRecoveryMailSink,
  createHeldRecoveryMailPort,
  createProductionRecoveryMailPort
} from "./recovery-mail-port.mjs";
import {
  createDevelopmentRegistrationMailSink,
  createHeldRegistrationMailPort,
  createProductionRegistrationMailPort
} from "./registration-mail-port.mjs";
import { digest } from "./security.mjs";

const RECOVERY_MODES = new Set([
  "production",
  "held",
  "dev-sink"
]);
const REGISTRATION_MODES = new Set([
  "production",
  "held",
  "dev-sink"
]);

function environmentValue(environment, name) {
  const value = environment?.[name];
  return typeof value === "string" && value.length > 0
    ? value
    : null;
}

export function createAesGcmContactVault({ key, keyVersion = "v1" } = {}) {
  const secret = Buffer.isBuffer(key) ? key : Buffer.from(String(key ?? ""), "base64");
  invariant(
    secret.length === 32,
    "CONTACT_VAULT_CONFIGURATION_REQUIRED",
    "Contact vault key must decode to exactly 32 bytes.",
    { status: 500 }
  );
  return Object.freeze({
    async seal(input) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", secret, nonce);
      const aad = Buffer.from(
        JSON.stringify({
          schema: "sitesourcery.contact-vault/v1",
          tenantId: input.tenantId,
          customerId: input.customerId,
          purpose: input.purpose,
          keyVersion
        }),
        "utf8"
      );
      cipher.setAAD(aad);
      const plaintext = Buffer.from(JSON.stringify(input.payload), "utf8");
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const tag = cipher.getAuthTag();
      return {
        vaultRef: [
          "sealed",
          "v1",
          keyVersion,
          nonce.toString("base64url"),
          tag.toString("base64url"),
          ciphertext.toString("base64url")
        ].join(":"),
        payloadDigest: digest(plaintext),
        keyVersion
      };
    }
  });
}

export function createJsonCatalogPort(filePath) {
  if (!filePath) return createHeldCatalogPort();
  const resolved = path.resolve(filePath);
  return Object.freeze({
    async current() {
      const bytes = await readFile(resolved);
      invariant(
        bytes.length <= 1024 * 1024,
        "CATALOG_UNAVAILABLE",
        "Offer catalog file is too large.",
        { status: 503 }
      );
      let catalog;
      try {
        catalog = JSON.parse(bytes.toString("utf8"));
      } catch {
        invariant(false, "CATALOG_UNAVAILABLE", "Offer catalog file is invalid.", {
          status: 503
        });
      }
      return catalog;
    }
  });
}

export async function createConfiguredRecoveryMailPort({
  environment = process.env,
  importModule = (specifier) => import(specifier)
} = {}) {
  const mode =
    environmentValue(
      environment,
      "SITESOURCERY_RECOVERY_MAIL_MODE"
    ) ?? "production";
  invariant(
    RECOVERY_MODES.has(mode),
    "RECOVERY_DELIVERY_CONFIGURATION_REQUIRED",
    "SITESOURCERY_RECOVERY_MAIL_MODE must be production, held, or dev-sink.",
    { status: 500 }
  );
  const recoveryBaseUrl =
    environmentValue(
      environment,
      "SITESOURCERY_RECOVERY_BASE_URL"
    ) ??
    (mode === "dev-sink"
      ? "https://staging.sitesourcery.test/abracadabra/app/"
      : "https://sitesourcery.com/abracadabra/app/");

  if (mode === "held") {
    return createHeldRecoveryMailPort({ recoveryBaseUrl });
  }
  if (mode === "dev-sink") {
    invariant(
      environmentValue(environment, "NODE_ENV") !==
        "production",
      "RECOVERY_DELIVERY_CONFIGURATION_REQUIRED",
      "The development recovery sink is forbidden in production.",
      { status: 500 }
    );
    return createDevelopmentRecoveryMailSink({
      recoveryBaseUrl
    });
  }

  const modulePath = environmentValue(
    environment,
    "SITESOURCERY_RECOVERY_TRANSPORT_MODULE"
  );
  let transport = null;
  if (modulePath) {
    invariant(
      path.isAbsolute(modulePath),
      "RECOVERY_DELIVERY_CONFIGURATION_REQUIRED",
      "The recovery transport module path must be absolute.",
      { status: 500 }
    );
    const loaded = await importModule(
      pathToFileURL(modulePath).href
    );
    invariant(
      typeof loaded?.createRecoveryTransport ===
        "function",
      "RECOVERY_DELIVERY_CONFIGURATION_REQUIRED",
      "The recovery transport module must export createRecoveryTransport.",
      { status: 500 }
    );
    transport = await loaded.createRecoveryTransport();
  }
  return createProductionRecoveryMailPort({
    transport,
    recoveryBaseUrl
  });
}

export async function createConfiguredRegistrationMailPort({
  environment = process.env,
  importModule = (specifier) => import(specifier)
} = {}) {
  const mode =
    environmentValue(
      environment,
      "SITESOURCERY_REGISTRATION_MAIL_MODE"
    ) ?? "production";
  invariant(
    REGISTRATION_MODES.has(mode),
    "REGISTRATION_DELIVERY_CONFIGURATION_REQUIRED",
    "SITESOURCERY_REGISTRATION_MAIL_MODE must be production, held, or dev-sink.",
    { status: 500 }
  );
  const registrationBaseUrl =
    environmentValue(
      environment,
      "SITESOURCERY_REGISTRATION_BASE_URL"
    ) ??
    (mode === "dev-sink"
      ? "https://staging.sitesourcery.test/abracadabra/app/"
      : "https://sitesourcery.com/abracadabra/app/");

  if (mode === "held") {
    return createHeldRegistrationMailPort({
      registrationBaseUrl
    });
  }
  if (mode === "dev-sink") {
    invariant(
      environmentValue(environment, "NODE_ENV") !==
        "production",
      "REGISTRATION_DELIVERY_CONFIGURATION_REQUIRED",
      "The development registration sink is forbidden in production.",
      { status: 500 }
    );
    return createDevelopmentRegistrationMailSink({
      registrationBaseUrl
    });
  }

  const modulePath = environmentValue(
    environment,
    "SITESOURCERY_REGISTRATION_TRANSPORT_MODULE"
  );
  let transport = null;
  if (modulePath) {
    invariant(
      path.isAbsolute(modulePath),
      "REGISTRATION_DELIVERY_CONFIGURATION_REQUIRED",
      "The registration transport module path must be absolute.",
      { status: 500 }
    );
    const loaded = await importModule(
      pathToFileURL(modulePath).href
    );
    invariant(
      typeof loaded?.createRegistrationTransport ===
        "function",
      "REGISTRATION_DELIVERY_CONFIGURATION_REQUIRED",
      "The registration transport module must export createRegistrationTransport.",
      { status: 500 }
    );
    transport =
      await loaded.createRegistrationTransport();
  }
  return createProductionRegistrationMailPort({
    transport,
    registrationBaseUrl
  });
}
