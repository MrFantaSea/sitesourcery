import { createHmac } from "node:crypto";

import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";
import { canonicalJson } from "./security.mjs";

const PROVIDER = "twilio";
const VERSION = /^[a-z0-9][a-z0-9._-]{0,39}$/u;
const NUMBER_PURPOSE = "sitesourcery.responder-number-lookup/v1";
const CALLER_PURPOSE = "sitesourcery.responder-caller-route-lookup/v1";

// Phone-derived lookup identities live in a tiny keyspace, so an unkeyed
// SHA-256 is cheaply reversible. Every durable lookup digest is therefore a
// purpose-bound HMAC under the approved identity-pepper composition, and the
// key version travels with every stored digest so rotation can never
// silently break resolution.
function pepperBytes(value, field) {
  if (
    !Buffer.isBuffer(value) ||
    value.byteLength < 32 ||
    value.byteLength > 128
  ) {
    throw new HostedError(
      "RESPONDER_LOOKUP_DIGEST_CONFIGURATION_REQUIRED",
      `${field} is invalid.`,
      { status: 500 }
    );
  }
  return Buffer.from(value);
}

function version(value, field) {
  invariant(
    typeof value === "string" && VERSION.test(value),
    "RESPONDER_LOOKUP_DIGEST_CONFIGURATION_REQUIRED",
    `${field} is invalid.`,
    { status: 500 }
  );
  return value;
}

function address(value) {
  invariant(
    typeof value === "string" && value.length >= 1 && value.length <= 64 &&
      !/[\s\u0000]/u.test(value),
    "RESPONDER_LOOKUP_DIGEST_INVALID",
    "The Responder lookup address is invalid.",
    { status: 400 }
  );
  return value;
}

function purposeKey(pepper, purpose) {
  return createHmac("sha256", pepper).update(purpose, "utf8").digest();
}

function keyedDigest(key, purpose, selectedAddress) {
  return createHmac("sha256", key)
    .update(canonicalJson({
      schema: purpose,
      provider: PROVIDER,
      address: selectedAddress
    }), "utf8")
    .digest("hex");
}

export function createResponderLookupDigests({
  pepper,
  pepperVersion,
  previousPeppers = {}
} = {}) {
  const currentPepper = pepperBytes(pepper, "The current identity pepper");
  const currentVersion = version(
    pepperVersion,
    "The current identity pepper version"
  );
  invariant(
    previousPeppers !== null && typeof previousPeppers === "object" &&
      !Array.isArray(previousPeppers),
    "RESPONDER_LOOKUP_DIGEST_CONFIGURATION_REQUIRED",
    "Prior identity peppers are invalid.",
    { status: 500 }
  );
  const keyring = [{
    keyVersion: currentVersion,
    numberKey: purposeKey(currentPepper, NUMBER_PURPOSE),
    callerKey: purposeKey(currentPepper, CALLER_PURPOSE)
  }];
  for (const [priorVersion, priorPepper] of Object.entries(previousPeppers)) {
    const selectedVersion = version(
      priorVersion,
      "A prior identity pepper version"
    );
    invariant(
      selectedVersion !== currentVersion,
      "RESPONDER_LOOKUP_DIGEST_CONFIGURATION_REQUIRED",
      "Identity pepper versions must be distinct.",
      { status: 500 }
    );
    const selectedPepper = pepperBytes(
      priorPepper,
      "A prior identity pepper"
    );
    keyring.push({
      keyVersion: selectedVersion,
      numberKey: purposeKey(selectedPepper, NUMBER_PURPOSE),
      callerKey: purposeKey(selectedPepper, CALLER_PURPOSE)
    });
  }
  const verifierVersions = Object.freeze(
    keyring.map((entry) => entry.keyVersion)
  );

  return Object.freeze({
    kind: "responder-lookup-digests",
    providerEffects: false,
    writerVersion: currentVersion,
    verifierVersions,
    async readiness() {
      return deepFreeze({
        ready: true,
        verified: true,
        kind: "responder-lookup-digests",
        providerEffects: false,
        writerVersion: currentVersion,
        verifierVersions,
        secretMaterial: "redacted"
      });
    },
    numberLookupDigest(selectedAddress) {
      const selected = address(selectedAddress);
      return deepFreeze({
        digest: keyedDigest(keyring[0].numberKey, NUMBER_PURPOSE, selected),
        keyVersion: currentVersion
      });
    },
    numberLookupCandidates(selectedAddress) {
      const selected = address(selectedAddress);
      return deepFreeze(keyring.map((entry) => deepFreeze({
        digest: keyedDigest(entry.numberKey, NUMBER_PURPOSE, selected),
        keyVersion: entry.keyVersion
      })));
    },
    callerRouteDigest(selectedAddress) {
      const selected = address(selectedAddress);
      return deepFreeze({
        digest: keyedDigest(keyring[0].callerKey, CALLER_PURPOSE, selected),
        keyVersion: currentVersion
      });
    },
    callerRouteCandidates(selectedAddress) {
      const selected = address(selectedAddress);
      return deepFreeze(keyring.map((entry) => deepFreeze({
        digest: keyedDigest(entry.callerKey, CALLER_PURPOSE, selected),
        keyVersion: entry.keyVersion
      })));
    }
  });
}
