import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  IDENTITY_PEPPER_CONFIG_SCHEMA,
  IDENTITY_PEPPER_READINESS_SCHEMA,
  MAXIMUM_PRIOR_IDENTITY_PEPPERS,
  createIdentityPepperConfiguration
} from "../identity-pepper-config.mjs";
import {
  hashPasswordWithPepper,
  verifyPasswordWithPepper
} from "../identity-postgres.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);
const CURRENT_ENVIRONMENT = "SITESOURCERY_IDENTITY_PEPPER";
const PRIOR_ENVIRONMENT = "SITESOURCERY_IDENTITY_PEPPER_PRIOR_1";

function manifest({
  currentVersion = "identity-current",
  prior = []
} = {}) {
  return JSON.stringify({
    schema: IDENTITY_PEPPER_CONFIG_SCHEMA,
    current: {
      version: currentVersion,
      secretEnvironment: CURRENT_ENVIRONMENT
    },
    prior
  });
}

function prior(version, secretEnvironment = PRIOR_ENVIRONMENT) {
  return { version, secretEnvironment };
}

function ephemeralSecretLoader() {
  return () => randomBytes(48);
}

function stableEphemeralSecretLoader() {
  const selected = new Map();
  return (name) => {
    if (!selected.has(name)) selected.set(name, randomBytes(48));
    return selected.get(name);
  };
}

function compositionSummary(configuration) {
  return configuration.compose((options) => ({
    writerVersion: options.pepperVersion,
    writerIsBounded:
      Buffer.isBuffer(options.pepper) &&
      options.pepper.byteLength >= 32 &&
      options.pepper.byteLength <= 128,
    priorVersions: Object.keys(options.previousPeppers),
    priorReadersAreBounded:
      Object.keys(options.previousPeppers).length <=
        MAXIMUM_PRIOR_IDENTITY_PEPPERS,
    writerIsNotPrior: !Object.values(options.previousPeppers)
      .some((selected) => selected.equals(options.pepper))
  }));
}

test("one current writer composes with only explicit bounded prior readers", () => {
  const configuration = createIdentityPepperConfiguration({
    configurationJson: manifest({
      currentVersion: "identity-next",
      prior: [prior("identity-previous")]
    }),
    secretLoader: ephemeralSecretLoader()
  });
  assert.deepEqual(compositionSummary(configuration), {
    writerVersion: "identity-next",
    writerIsBounded: true,
    priorVersions: ["identity-previous"],
    priorReadersAreBounded: true,
    writerIsNotPrior: true
  });
  assert.deepEqual(configuration.readiness, {
    schema: IDENTITY_PEPPER_READINESS_SCHEMA,
    ready: true,
    writer: {
      version: "identity-next",
      currentOnly: true
    },
    verifier: {
      versions: ["identity-next", "identity-previous"],
      priorVersions: ["identity-previous"],
      maximumPriorVersions: MAXIMUM_PRIOR_IDENTITY_PEPPERS
    },
    secretMaterial: "redacted"
  });
});

test("existing v1 writer identity remains valid during config adoption", () => {
  const configuration = createIdentityPepperConfiguration({
    configurationJson: manifest({ currentVersion: "v1" }),
    secretLoader: ephemeralSecretLoader()
  });
  assert.equal(compositionSummary(configuration).writerVersion, "v1");
  assert.deepEqual(configuration.readiness.verifier.priorVersions, []);
});

test("retirement removes only the explicit prior reader and preserves writer identity", () => {
  const secretLoader = stableEphemeralSecretLoader();
  const overlap = createIdentityPepperConfiguration({
    configurationJson: manifest({
      currentVersion: "identity-next",
      prior: [prior("identity-previous")]
    }),
    secretLoader
  });
  const retired = createIdentityPepperConfiguration({
    configurationJson: manifest({
      currentVersion: "identity-next"
    }),
    secretLoader
  });
  let overlapWriter;
  overlap.compose((options) => {
    overlapWriter = options.pepper;
    return null;
  });
  const writerPreserved = retired.compose((options) =>
    options.pepper.equals(overlapWriter)
  );
  assert.deepEqual(
    compositionSummary(overlap).priorVersions,
    ["identity-previous"]
  );
  assert.deepEqual(compositionSummary(retired), {
    writerVersion: "identity-next",
    writerIsBounded: true,
    priorVersions: [],
    priorReadersAreBounded: true,
    writerIsNotPrior: true
  });
  assert.equal(writerPreserved, true);
});

test("overlap verifies a prior credential while retirement fails closed", async () => {
  const overlap = createIdentityPepperConfiguration({
    configurationJson: manifest({
      currentVersion: "identity-next",
      prior: [prior("identity-previous")]
    }),
    secretLoader: ephemeralSecretLoader()
  });
  const overlapHarness = overlap.compose((options) => ({
    createPriorCredential(rawPassword) {
      return hashPasswordWithPepper(rawPassword, {
        pepper: options.previousPeppers["identity-previous"],
        pepperVersion: "identity-previous"
      });
    },
    verify(rawPassword, encoded) {
      return verifyPasswordWithPepper(
        rawPassword,
        encoded,
        async (selectedVersion) =>
          selectedVersion === options.pepperVersion
            ? options.pepper
            : options.previousPeppers[selectedVersion] ?? null
      );
    }
  }));
  const encoded = await overlapHarness.createPriorCredential(
    "rotation proof password"
  );
  assert.equal(
    await overlapHarness.verify("rotation proof password", encoded),
    true
  );

  const retired = createIdentityPepperConfiguration({
    configurationJson: manifest({ currentVersion: "identity-next" }),
    secretLoader: ephemeralSecretLoader()
  });
  const retiredVerifier = retired.compose((options) =>
    (rawPassword, selectedCredential) => verifyPasswordWithPepper(
      rawPassword,
      selectedCredential,
      async (selectedVersion) =>
        selectedVersion === options.pepperVersion
          ? options.pepper
          : options.previousPeppers[selectedVersion] ?? null
    )
  );
  assert.equal(
    await retiredVerifier("rotation proof password", encoded),
    false
  );
});

test("invalid duplicate incomplete excessive and unbounded configurations fail closed", () => {
  const validCurrent = {
    version: "identity-current",
    secretEnvironment: CURRENT_ENVIRONMENT
  };
  const cases = [
    undefined,
    "",
    "{",
    JSON.stringify({
      schema: IDENTITY_PEPPER_CONFIG_SCHEMA,
      current: validCurrent
    }),
    JSON.stringify({
      schema: "sitesourcery.identity-pepper-config/v2",
      current: validCurrent,
      prior: []
    }),
    manifest({ currentVersion: "" }),
    manifest({ currentVersion: "A" }),
    manifest({ currentVersion: "a".repeat(41) }),
    manifest({
      prior: [
        prior("identity-old"),
        prior("identity-old", "SITESOURCERY_IDENTITY_PEPPER_PRIOR_2")
      ]
    }),
    manifest({ prior: [prior("identity-current")] }),
    manifest({
      prior: [
        prior("identity-old"),
        prior("identity-older")
      ]
    }),
    manifest({
      prior: [
        prior("identity-old-1", "SITESOURCERY_IDENTITY_PEPPER_PRIOR_1"),
        prior("identity-old-2", "SITESOURCERY_IDENTITY_PEPPER_PRIOR_2"),
        prior("identity-old-3", "SITESOURCERY_IDENTITY_PEPPER_PRIOR_3"),
        prior("identity-old-4", "SITESOURCERY_IDENTITY_PEPPER_PRIOR_4")
      ]
    }),
    manifest({
      prior: [prior("identity-old", "SITESOURCERY_DATABASE_URL")]
    })
  ];
  for (const configurationJson of cases) {
    assert.throws(
      () => createIdentityPepperConfiguration({
        configurationJson,
        secretLoader: ephemeralSecretLoader()
      }),
      (error) =>
        error?.code === "IDENTITY_PEPPER_CONFIGURATION_INVALID" &&
        error?.message === "Identity pepper configuration is invalid."
    );
  }
  for (const length of [0, 31, 129]) {
    assert.throws(
      () => createIdentityPepperConfiguration({
        configurationJson: manifest(),
        secretLoader: () => randomBytes(length)
      }),
      (error) =>
        error?.code === "IDENTITY_PEPPER_CONFIGURATION_INVALID"
    );
  }
  const configured = createIdentityPepperConfiguration({
    configurationJson: manifest(),
    secretLoader: ephemeralSecretLoader()
  });
  assert.throws(
    () => configured.compose(() => null, { pepper: null }),
    (error) => error?.code === "IDENTITY_PEPPER_CONFIGURATION_INVALID"
  );
});

test("secret decoding and duplicate material failures reveal no submitted material", () => {
  const submitted = "OBVIOUSLY-NOT-A-SECRET";
  assert.throws(
    () => createIdentityPepperConfiguration({
      environment: {
        SITESOURCERY_IDENTITY_PEPPER_CONFIG: manifest(),
        SITESOURCERY_IDENTITY_PEPPER: submitted
      }
    }),
    (error) =>
      error?.code === "IDENTITY_PEPPER_CONFIGURATION_INVALID" &&
      !error.message.includes(submitted)
  );

  const reusedMaterial = randomBytes(48);
  assert.throws(
    () => createIdentityPepperConfiguration({
      configurationJson: manifest({
        prior: [prior("identity-old")]
      }),
      secretLoader: () => reusedMaterial
    }),
    (error) =>
      error?.code === "IDENTITY_PEPPER_CONFIGURATION_INVALID" &&
      error?.message === "Identity pepper configuration is invalid."
  );
});

test("configuration and readiness serialization are metadata-only", () => {
  const configuration = createIdentityPepperConfiguration({
    configurationJson: manifest({
      prior: [prior("identity-old")]
    }),
    secretLoader: ephemeralSecretLoader()
  });
  const serialized = JSON.stringify(configuration);
  assert.match(serialized, /"secretMaterial":"redacted"/u);
  assert.doesNotMatch(serialized, /SITESOURCERY_IDENTITY_PEPPER/u);
  assert.doesNotMatch(serialized, /"type":"Buffer"/u);
  assert.doesNotMatch(serialized, /"data":\[/u);
});

test("held example is structurally valid and contains placeholders only", async () => {
  const source = await readFile(
    path.join(root, "ops/identity-pepper-config.held.example.json"),
    "utf8"
  );
  const example = JSON.parse(source);
  assert.equal(example.current.version, "replace-current-version");
  assert.deepEqual(
    example.prior.map((entry) => entry.version),
    ["replace-prior-version"]
  );
  const configured = createIdentityPepperConfiguration({
    configurationJson: source,
    secretLoader: ephemeralSecretLoader()
  });
  assert.equal(configured.readiness.secretMaterial, "redacted");
  assert.doesNotMatch(source, /"(?:pepper|secret|value)"\s*:/iu);
});

test("production composition uses the adapter and emits only redacted readiness", async () => {
  const source = await readFile(
    path.join(root, "server/hosted/bin/server.mjs"),
    "utf8"
  );
  const configSource = await readFile(
    path.join(root, "server/hosted/identity-pepper-config.mjs"),
    "utf8"
  );
  assert.match(source, /identityPepperConfigurationFromEnvironment/u);
  assert.match(
    source,
    /identityPepperConfiguration\.compose\(\s*createPostgresIdentityBridge/u
  );
  assert.match(
    source,
    /identityPepper:\s*identityPepperConfiguration\.readiness/u
  );
  assert.doesNotMatch(source, /SITESOURCERY_IDENTITY_PEPPER_VERSION/u);
  assert.doesNotMatch(source, /pepper:\s*identityPepper/u);
  assert.doesNotMatch(
    configSource,
    /process\.argv|console\.|process\.(?:stdout|stderr)|(?:write|append)File/u
  );
});
