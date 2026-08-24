#!/usr/bin/env node

import {
  createStripeCredentialActivationReceipt
} from "./credential-topology.mjs";
import {
  stripeRuntimeKeyFingerprint
} from "../server/commerce/adapters/stripe.mjs";

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function exactUtc(value, field) {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    fail(
      "STRIPE_ACTIVATION_RECEIPT_INPUT_INVALID",
      `${field} must be an exact UTC instant.`
    );
  }
  return value;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  if (
    index === -1 ||
    index + 1 >= process.argv.length ||
    process.argv[index + 1].startsWith("--")
  ) {
    fail(
      "STRIPE_ACTIVATION_RECEIPT_INPUT_INVALID",
      `${name} is required.`
    );
  }
  return process.argv[index + 1];
}

function environmentJson(name) {
  const text = process.env[name];
  if (typeof text !== "string" || text.length === 0) {
    fail(
      "STRIPE_ACTIVATION_RECEIPT_INPUT_INVALID",
      `${name} is required.`
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    fail(
      "STRIPE_ACTIVATION_RECEIPT_INPUT_INVALID",
      `${name} must contain valid JSON.`
    );
  }
}

try {
  if (
    process.env.SITESOURCERY_DEPLOYMENT_ENVIRONMENT !==
      "production" ||
    process.env.SITESOURCERY_STRIPE_LIVEMODE !== "true"
  ) {
    fail(
      "STRIPE_ACTIVATION_RECEIPT_MODE_INVALID",
      "Activation receipts are production-live only."
    );
  }
  const secretKey =
    process.env.SITESOURCERY_STRIPE_SECRET_KEY;
  if (
    typeof secretKey !== "string" ||
    !secretKey.startsWith("rk_live_")
  ) {
    fail(
      "STRIPE_ACTIVATION_RECEIPT_KEY_INVALID",
      "The exact production restricted runtime key is required."
    );
  }
  const receipt =
    createStripeCredentialActivationReceipt(
      environmentJson(
        "SITESOURCERY_CREDENTIAL_TOPOLOGY_JSON"
      ),
      {
        now: new Date().toISOString(),
        validUntil: exactUtc(
          argument("--valid-until"),
          "--valid-until"
        ),
        environment: "production",
        livemode: true,
        runtimeFingerprint:
          stripeRuntimeKeyFingerprint(secretKey)
      }
    );
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
} catch (error) {
  process.stderr.write(
    `${error?.code ?? "STRIPE_ACTIVATION_RECEIPT_FAILED"}: ` +
      `${error?.message ?? "receipt issuance failed"}\n`
  );
  process.exitCode = 1;
}
