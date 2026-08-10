import { timingSafeEqual } from "node:crypto";

export const IDENTITY_PEPPER_CONFIG_ENVIRONMENT =
  "SITESOURCERY_IDENTITY_PEPPER_CONFIG";
export const IDENTITY_PEPPER_CONFIG_SCHEMA =
  "sitesourcery.identity-pepper-config/v1";
export const IDENTITY_PEPPER_READINESS_SCHEMA =
  "sitesourcery.identity-pepper-readiness/v1";
export const MAXIMUM_PRIOR_IDENTITY_PEPPERS = 3;

const CURRENT_SECRET_ENVIRONMENT =
  "SITESOURCERY_IDENTITY_PEPPER";
const PRIOR_SECRET_ENVIRONMENTS = new Set([
  "SITESOURCERY_IDENTITY_PEPPER_PRIOR_1",
  "SITESOURCERY_IDENTITY_PEPPER_PRIOR_2",
  "SITESOURCERY_IDENTITY_PEPPER_PRIOR_3"
]);
const VERSION = /^[a-z0-9][a-z0-9._-]{0,39}$/u;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const MAXIMUM_CONFIG_BYTES = 2_048;
const MINIMUM_PEPPER_BYTES = 32;
const MAXIMUM_PEPPER_BYTES = 128;

export class IdentityPepperConfigurationError extends Error {
  constructor() {
    super("Identity pepper configuration is invalid.");
    this.name = "IdentityPepperConfigurationError";
    this.code = "IDENTITY_PEPPER_CONFIGURATION_INVALID";
  }
}

function fail() {
  throw new IdentityPepperConfigurationError();
}

function exactObject(value, keys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify([...keys].sort())
  ) fail();
  return value;
}

function version(value) {
  if (typeof value !== "string" || !VERSION.test(value)) fail();
  return value;
}

function decodeSecret(environment, name) {
  const encoded = environment[name];
  if (
    typeof encoded !== "string" ||
    encoded.length === 0 ||
    encoded.length > 256 ||
    !BASE64.test(encoded)
  ) fail();
  const selected = Buffer.from(encoded, "base64");
  if (
    selected.byteLength < MINIMUM_PEPPER_BYTES ||
    selected.byteLength > MAXIMUM_PEPPER_BYTES ||
    selected.toString("base64") !== encoded
  ) fail();
  return selected;
}

function selectedSecret(loader, name) {
  let value;
  try {
    value = loader(name);
  } catch {
    fail();
  }
  if (
    !Buffer.isBuffer(value) ||
    value.byteLength < MINIMUM_PEPPER_BYTES ||
    value.byteLength > MAXIMUM_PEPPER_BYTES
  ) fail();
  return Buffer.from(value);
}

function sameSecret(left, right) {
  return left.byteLength === right.byteLength &&
    timingSafeEqual(left, right);
}

function parseConfiguration(configurationJson) {
  if (
    typeof configurationJson !== "string" ||
    configurationJson.length === 0 ||
    Buffer.byteLength(configurationJson, "utf8") > MAXIMUM_CONFIG_BYTES
  ) fail();
  let parsed;
  try {
    parsed = JSON.parse(configurationJson);
  } catch {
    fail();
  }
  exactObject(parsed, ["schema", "current", "prior"]);
  if (parsed.schema !== IDENTITY_PEPPER_CONFIG_SCHEMA) fail();
  exactObject(parsed.current, ["version", "secretEnvironment"]);
  if (
    parsed.current.secretEnvironment !== CURRENT_SECRET_ENVIRONMENT ||
    !Array.isArray(parsed.prior) ||
    parsed.prior.length > MAXIMUM_PRIOR_IDENTITY_PEPPERS
  ) fail();
  const currentVersion = version(parsed.current.version);
  const versions = new Set([currentVersion]);
  const environments = new Set([CURRENT_SECRET_ENVIRONMENT]);
  const prior = parsed.prior.map((entry) => {
    exactObject(entry, ["version", "secretEnvironment"]);
    const selectedVersion = version(entry.version);
    if (
      versions.has(selectedVersion) ||
      !PRIOR_SECRET_ENVIRONMENTS.has(entry.secretEnvironment) ||
      environments.has(entry.secretEnvironment)
    ) fail();
    versions.add(selectedVersion);
    environments.add(entry.secretEnvironment);
    return Object.freeze({
      version: selectedVersion,
      secretEnvironment: entry.secretEnvironment
    });
  });
  return Object.freeze({
    current: Object.freeze({
      version: currentVersion,
      secretEnvironment: CURRENT_SECRET_ENVIRONMENT
    }),
    prior: Object.freeze(prior)
  });
}

export function createIdentityPepperConfiguration({
  environment = {},
  configurationJson = environment[IDENTITY_PEPPER_CONFIG_ENVIRONMENT],
  secretLoader = (name) => decodeSecret(environment, name)
} = {}) {
  if (
    !environment ||
    typeof environment !== "object" ||
    typeof secretLoader !== "function"
  ) fail();
  const selected = parseConfiguration(configurationJson);
  const currentSecret = selectedSecret(
    secretLoader,
    selected.current.secretEnvironment
  );
  const priorSecrets = selected.prior.map((entry) => Object.freeze({
    version: entry.version,
    secret: selectedSecret(secretLoader, entry.secretEnvironment)
  }));
  const everySecret = [
    currentSecret,
    ...priorSecrets.map((entry) => entry.secret)
  ];
  for (const [index, candidate] of everySecret.entries()) {
    if (
      everySecret.some(
        (other, otherIndex) =>
          otherIndex < index && sameSecret(candidate, other)
      )
    ) fail();
  }

  const priorVersions = Object.freeze(
    selected.prior.map((entry) => entry.version)
  );
  const readiness = Object.freeze({
    schema: IDENTITY_PEPPER_READINESS_SCHEMA,
    ready: true,
    writer: Object.freeze({
      version: selected.current.version,
      currentOnly: true
    }),
    verifier: Object.freeze({
      versions: Object.freeze([
        selected.current.version,
        ...priorVersions
      ]),
      priorVersions,
      maximumPriorVersions: MAXIMUM_PRIOR_IDENTITY_PEPPERS
    }),
    secretMaterial: "redacted"
  });

  return Object.freeze({
    readiness,
    compose(factory, options = {}) {
      if (
        typeof factory !== "function" ||
        !options ||
        typeof options !== "object" ||
        Array.isArray(options) ||
        Object.hasOwn(options, "pepper") ||
        Object.hasOwn(options, "pepperVersion") ||
        Object.hasOwn(options, "previousPeppers")
      ) fail();
      const previousPeppers = Object.create(null);
      for (const entry of priorSecrets) {
        previousPeppers[entry.version] = Buffer.from(entry.secret);
      }
      return factory({
        ...options,
        pepper: Buffer.from(currentSecret),
        pepperVersion: selected.current.version,
        previousPeppers: Object.freeze(previousPeppers)
      });
    }
  });
}

export function identityPepperConfigurationFromEnvironment(
  environment = process.env
) {
  return createIdentityPepperConfiguration({ environment });
}
